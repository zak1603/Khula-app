-- =============================================================================
-- Khula — 0200 Security: authorization helpers, guard triggers, audit chain,
-- and STRICT Row Level Security on every table.
--
-- Threat model highlights
--   * Privilege escalation via profile.role  -> column grants + guard trigger
--   * Cross-tenant reads (salon A reads salon B) -> membership helpers in RLS
--   * Clients enumerating other clients' bookings -> appointments RLS + RPC-only writes
--   * Staff reading private client notes w/o permission -> can_view_client_notes()
--   * Tampering with audit history -> append-only + SHA-256 hash chain
--   * RLS recursion / perf -> SECURITY DEFINER STABLE helpers, (select auth.uid())
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Context helpers
-- -----------------------------------------------------------------------------

-- TRUE when the current statement runs as a privileged DB role: inside a
-- SECURITY DEFINER function (current_user = owner), via service_role, a
-- migration, pg_cron, or a referential action. FALSE for end-user requests
-- coming through PostgREST (anon / authenticated).
-- MUST stay SECURITY INVOKER — it reads current_user.
create or replace function public.is_privileged_context()
returns boolean
language sql
stable
set search_path = ''
as $$ select current_user not in ('anon', 'authenticated') $$;

-- TRUE when the request was made with the service_role JWT (Edge Functions,
-- trusted servers). Works inside SECURITY DEFINER functions (reads JWT claims).
create or replace function public.is_service_role()
returns boolean
language sql
stable
set search_path = ''
as $$ select coalesce(auth.jwt() ->> 'role', '') = 'service_role' $$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
      and p.anonymized_at is null
  );
$$;

create or replace function public.is_business_owner(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.businesses b
    where b.id = p_business_id
      and b.owner_id = (select auth.uid())
  );
$$;

-- Owner, or an ACTIVE staff member who has ACCEPTED their invite.
create or replace function public.is_business_member(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_business_owner(p_business_id)
      or exists (
        select 1 from public.staff_members s
        where s.business_id = p_business_id
          and s.profile_id = (select auth.uid())
          and s.is_active
          and s.invite_accepted_at is not null
      );
$$;

create or replace function public.can_manage_bookings(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_business_owner(p_business_id)
      or exists (
        select 1 from public.staff_members s
        where s.business_id = p_business_id
          and s.profile_id = (select auth.uid())
          and s.is_active
          and s.invite_accepted_at is not null
          and s.can_manage_bookings
      );
$$;

create or replace function public.can_view_client_notes(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_business_owner(p_business_id)
      or exists (
        select 1 from public.staff_members s
        where s.business_id = p_business_id
          and s.profile_id = (select auth.uid())
          and s.is_active
          and s.invite_accepted_at is not null
          and s.can_view_client_notes
      );
$$;

create or replace function public.current_staff_id(p_business_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id from public.staff_members s
  where s.business_id = p_business_id
    and s.profile_id = (select auth.uid())
    and s.is_active
    and s.invite_accepted_at is not null
  limit 1;
$$;

create or replace function public.is_business_public(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.businesses b where b.id = p_business_id and b.is_active);
$$;

-- Who may read a profile row (name / phone / avatar)?
--   self, admins, colleagues in a shared business, and businesses the person
--   has booked with (so the provider can see who is coming).
create or replace function public.can_view_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile_id = (select auth.uid())
      or public.is_admin()
      or exists (
        select 1 from public.appointments a
        where a.client_id = p_profile_id
          and public.is_business_member(a.business_id)
      )
      or exists (
        select 1 from public.staff_members s
        where s.profile_id = p_profile_id
          and public.is_business_member(s.business_id)
      )
      or exists (
        select 1 from public.businesses b
        where b.owner_id = p_profile_id
          and public.is_business_member(b.id)
      );
$$;

-- Safe text -> uuid (NULL instead of an exception). Used by storage policies.
create or replace function public.try_uuid(p text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Audit log: append-only + hash chain
-- -----------------------------------------------------------------------------

create or replace function public.audit_logs_chain()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_prev_hash text;
  v_prev_seq  bigint;
begin
  -- Serialise writers so the chain is strictly linear.
  perform pg_advisory_xact_lock(hashtext('public.audit_logs.chain'));

  select l.row_hash, l.chain_seq
    into v_prev_hash, v_prev_seq
  from public.audit_logs l
  order by l.chain_seq desc
  limit 1;

  new.chain_seq   := coalesce(v_prev_seq, 0) + 1;
  new.occurred_at := clock_timestamp();
  new.prev_hash   := v_prev_hash;
  new.row_hash    := encode(sha256(convert_to(concat_ws('|',
      coalesce(v_prev_hash, 'GENESIS'),
      new.chain_seq::text,
      extract(epoch from new.occurred_at)::text,   -- timezone-independent
      coalesce(new.actor_id::text, ''),
      coalesce(new.actor_role, ''),
      new.action,
      new.entity_type,
      coalesce(new.entity_id, ''),
      coalesce(new.business_id::text, ''),
      new.metadata::text                            -- jsonb text form is canonical
    ), 'UTF8')), 'hex');
  return new;
end;
$$;

create trigger audit_logs_chain
  before insert on public.audit_logs
  for each row execute function public.audit_logs_chain();

create or replace function public.audit_logs_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'AUDIT_LOG_IMMUTABLE' using errcode = 'PT403';
end;
$$;

create trigger audit_logs_no_update_delete
  before update or delete on public.audit_logs
  for each row execute function public.audit_logs_immutable();

create trigger audit_logs_no_truncate
  before truncate on public.audit_logs
  for each statement execute function public.audit_logs_immutable();

-- Internal writer. Not executable by end users (see grants in 0600).
create or replace function public.write_audit_log(
  p_action       text,
  p_entity_type  text,
  p_entity_id    text,
  p_business_id  uuid,
  p_metadata     jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, business_id, metadata, chain_seq, row_hash)
  values (
    auth.uid(),
    coalesce(auth.jwt() ->> 'role', session_user::text),
    p_action,
    p_entity_type,
    p_entity_id,
    p_business_id,
    coalesce(p_metadata, '{}'::jsonb),
    0,   -- placeholder; overwritten by audit_logs_chain trigger
    ''   -- placeholder; overwritten by audit_logs_chain trigger
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Generic row-change auditor. TG_ARGV lists columns whose VALUES are safe to
-- log (non-PII, e.g. commission_bps). For all other columns only the NAME of
-- the changed column is recorded — never the personal data itself.
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old      jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new      jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row      jsonb := coalesce(v_new, v_old);
  v_safe     text[] := coalesce(tg_argv::text[], '{}'::text[]);
  v_changed  text[] := '{}'::text[];
  v_diff     jsonb := '{}'::jsonb;
  v_key      text;
  v_business uuid;
begin
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(n.key order by n.key), '{}'::text[])
      into v_changed
    from jsonb_each(v_new) n
    where n.value is distinct from (v_old -> n.key)
      and n.key not in ('updated_at');
    if cardinality(v_changed) = 0 then
      return null;
    end if;
    foreach v_key in array v_changed loop
      if v_key = any (v_safe) then
        v_diff := v_diff || jsonb_build_object(v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key));
      end if;
    end loop;
  end if;

  v_business := case
    when tg_table_name = 'businesses' then (v_row ->> 'id')::uuid
    else nullif(v_row ->> 'business_id', '')::uuid
  end;

  perform public.write_audit_log(
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    v_row ->> 'id',
    v_business,
    jsonb_build_object('changed_columns', to_jsonb(v_changed), 'diff', v_diff)
  );
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Auth: create profile on sign-up (role whitelisted — never admin/staff)
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta     jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_role     public.user_role := 'client';
  v_name     text := nullif(left(btrim(coalesce(v_meta ->> 'full_name', '')), 120), '');
  v_phone    text := v_meta ->> 'phone';
  v_version  text := v_meta ->> 'popia_consent_version';
begin
  if v_meta ->> 'account_type' = 'business_owner' then
    v_role := 'business_owner';
  end if;
  if v_name is not null and v_name ~ '[<>]' then
    v_name := null;
  end if;
  if v_phone is not null and v_phone !~ '^\+27[1-9][0-9]{8}$' then
    v_phone := null;
  end if;
  if v_version is not null and v_version !~ '^[A-Za-z0-9._-]{1,20}$' then
    v_version := null;
  end if;

  insert into public.profiles (id, role, full_name, phone, popia_consent_at, popia_consent_version, marketing_opt_in)
  values (
    new.id,
    v_role,
    v_name,
    v_phone,
    case when v_meta ->> 'popia_consent' = 'true' then now() end,
    v_version,
    coalesce((v_meta ->> 'marketing_opt_in')::boolean, false)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Guard triggers
-- -----------------------------------------------------------------------------

-- profiles: role changes only by admins / privileged code paths.
create or replace function public.profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_privileged_context() then
    return new;
  end if;
  if new.id is distinct from old.id then
    raise exception 'PROFILE_ID_IMMUTABLE' using errcode = 'PT403';
  end if;
  if (new.role is distinct from old.role
      or new.anonymized_at is distinct from old.anonymized_at
      or new.popia_consent_at is distinct from old.popia_consent_at)
     and not public.is_admin() then
    raise exception 'FORBIDDEN_PROFILE_FIELD' using errcode = 'PT403';
  end if;
  return new;
end;
$$;

create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard();

-- staff_members:
--   * owners cannot attach an arbitrary user account (profile link only via invite acceptance)
--   * staff may edit ONLY their own working_hours
create or replace function public.staff_members_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_privileged_context() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.profile_id := null;
    new.invite_accepted_at := null;
    new.invite_email := lower(new.invite_email);
    return new;
  end if;

  if new.business_id <> old.business_id
     or new.profile_id is distinct from old.profile_id
     or new.invite_accepted_at is distinct from old.invite_accepted_at then
    raise exception 'STAFF_LINK_IMMUTABLE' using errcode = 'PT403';
  end if;

  if public.is_business_owner(old.business_id) or public.is_admin() then
    new.invite_email := lower(new.invite_email);
    return new;
  end if;

  if old.profile_id = (select auth.uid()) then
    if (to_jsonb(new) - 'working_hours' - 'updated_at') <> (to_jsonb(old) - 'working_hours' - 'updated_at') then
      raise exception 'STAFF_MAY_ONLY_EDIT_WORKING_HOURS' using errcode = 'PT403';
    end if;
    return new;
  end if;

  raise exception 'FORBIDDEN' using errcode = 'PT403';
end;
$$;

create trigger staff_members_guard
  before insert or update on public.staff_members
  for each row execute function public.staff_members_guard();

-- Independent professionals: the owner is automatically the first staff lane.
create or replace function public.businesses_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.staff_members (
    business_id, profile_id, display_name, invite_accepted_at,
    commission_bps, can_view_client_notes, can_manage_bookings, working_hours
  )
  select new.id, new.owner_id, coalesce(p.full_name, 'Owner'), now(),
         10000, true, true,
         '{"mon":[{"start":"08:00","end":"17:00"}],"tue":[{"start":"08:00","end":"17:00"}],"wed":[{"start":"08:00","end":"17:00"}],"thu":[{"start":"08:00","end":"17:00"}],"fri":[{"start":"08:00","end":"17:00"}]}'::jsonb
  from public.profiles p
  where p.id = new.owner_id;
  return null;
end;
$$;

create trigger businesses_after_insert
  after insert on public.businesses
  for each row execute function public.businesses_after_insert();

-- appointments: state machine + derived fields.
create or replace function public.is_valid_appointment_transition(
  p_from public.appointment_status,
  p_to   public.appointment_status
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_from
    when 'requested' then p_to in ('quoted', 'confirmed', 'cancelled')
    when 'quoted'    then p_to in ('requested', 'confirmed', 'cancelled')
    when 'confirmed' then p_to in ('completed', 'cancelled')
    else false              -- completed / cancelled are terminal
  end;
$$;

create or replace function public.appointments_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.blocked_until := new.ends_at + make_interval(mins => new.buffer_minutes);

  if tg_op = 'UPDATE' then
    if new.business_id <> old.business_id then
      raise exception 'APPOINTMENT_BUSINESS_IMMUTABLE' using errcode = 'PT403';
    end if;
    -- client_id may only be cleared (FK ON DELETE SET NULL), never reassigned
    if new.client_id is not null and new.client_id is distinct from old.client_id then
      raise exception 'APPOINTMENT_CLIENT_IMMUTABLE' using errcode = 'PT403';
    end if;

    if new.status is distinct from old.status then
      if not public.is_valid_appointment_transition(old.status, new.status) then
        raise exception 'INVALID_STATUS_TRANSITION: % -> %', old.status, new.status using errcode = 'PT409';
      end if;
      case new.status
        when 'cancelled' then
          new.cancelled_at := coalesce(new.cancelled_at, now());
          new.hold_expires_at := null;
        when 'completed' then
          new.completed_at := coalesce(new.completed_at, now());
          new.progress := 'finished';
          -- snapshot commission so later commission edits don't rewrite history
          select s.commission_bps into new.commission_bps
          from public.staff_members s where s.id = new.staff_id;
        when 'confirmed' then
          new.hold_expires_at := null;
        else
          null;
      end case;
    end if;

    if new.progress is distinct from old.progress
       and new.status not in ('confirmed', 'completed') then
      raise exception 'PROGRESS_REQUIRES_CONFIRMED' using errcode = 'PT409';
    end if;

    -- Closed appointments are immutable (except privileged maintenance such
    -- as POPIA address purges and FK referential actions).
    if old.status in ('completed', 'cancelled')
       and not public.is_privileged_context()
       and (new.starts_at, new.ends_at, new.staff_id, new.total_price_cents)
           is distinct from (old.starts_at, old.ends_at, old.staff_id, old.total_price_cents) then
      raise exception 'APPOINTMENT_CLOSED' using errcode = 'PT409';
    end if;
  end if;

  return new;
end;
$$;

create trigger appointments_before_write
  before insert or update on public.appointments
  for each row execute function public.appointments_before_write();

create or replace function public.appointments_log_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.appointment_events (appointment_id, business_id, actor_id, event_type, to_status, to_progress)
    values (new.id, new.business_id, auth.uid(), 'created', new.status, new.progress);
    return null;
  end if;

  if new.status is distinct from old.status then
    insert into public.appointment_events (appointment_id, business_id, actor_id, event_type, from_status, to_status, note)
    values (new.id, new.business_id, auth.uid(), 'status_changed', old.status, new.status,
            case when new.status = 'cancelled' then left(new.cancellation_reason, 500) end);
  end if;

  if new.progress is distinct from old.progress then
    insert into public.appointment_events (appointment_id, business_id, actor_id, event_type, from_progress, to_progress)
    values (new.id, new.business_id, auth.uid(), 'progress_changed', old.progress, new.progress);
  end if;

  if (new.starts_at, new.staff_id) is distinct from (old.starts_at, old.staff_id) then
    insert into public.appointment_events (appointment_id, business_id, actor_id, event_type, note)
    values (new.id, new.business_id, auth.uid(), 'rescheduled',
            'Moved to ' || to_char(new.starts_at at time zone public.app_timezone(), 'YYYY-MM-DD HH24:MI'));
  end if;

  return null;
end;
$$;

create trigger appointments_log_event
  after insert or update on public.appointments
  for each row execute function public.appointments_log_event();

-- -----------------------------------------------------------------------------
-- Audit triggers on sensitive tables (values logged only for non-PII columns)
-- -----------------------------------------------------------------------------
create trigger audit_profiles
  after update on public.profiles
  for each row execute function public.audit_row_change('role', 'marketing_opt_in', 'anonymized_at');

create trigger audit_businesses
  after insert or update on public.businesses
  for each row execute function public.audit_row_change('is_verified', 'is_active', 'platform_fee_bps', 'paystack_subaccount_code', 'service_model', 'travel_radius_km');

create trigger audit_staff_members
  after insert or update or delete on public.staff_members
  for each row execute function public.audit_row_change('commission_bps', 'can_view_client_notes', 'can_manage_bookings', 'is_active');

create trigger audit_services
  after update or delete on public.services
  for each row execute function public.audit_row_change('price_cents', 'pricing_model', 'deposit_percent', 'is_active');

create trigger audit_client_notes
  after insert or update or delete on public.client_notes
  for each row execute function public.audit_row_change();

create trigger audit_transactions
  after update on public.transactions
  for each row execute function public.audit_row_change('status', 'requires_refund', 'amount_cents', 'platform_fee_cents');

create trigger audit_payment_methods
  after insert or delete on public.payment_methods
  for each row execute function public.audit_row_change();

create trigger audit_staff_tips
  after insert on public.staff_tips
  for each row execute function public.audit_row_change();

-- =============================================================================
-- ROW LEVEL SECURITY
-- Rule of thumb: no policy => no access. service_role bypasses RLS.
-- =============================================================================
alter table public.categories          enable row level security;
alter table public.profiles            enable row level security;
alter table public.businesses          enable row level security;
alter table public.staff_members       enable row level security;
alter table public.services            enable row level security;
alter table public.appointments        enable row level security;
alter table public.appointment_quotes  enable row level security;
alter table public.appointment_events  enable row level security;
alter table public.client_notes        enable row level security;
alter table public.transactions        enable row level security;
alter table public.staff_tips          enable row level security;
alter table public.payment_methods     enable row level security;
alter table public.webhook_events      enable row level security;
alter table public.audit_logs          enable row level security;

-- categories ------------------------------------------------------------------
create policy categories_select_all on public.categories
  for select to anon, authenticated
  using (true);

-- profiles --------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated
  using (public.can_view_profile(id));

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) and anonymized_at is null)
  with check (id = (select auth.uid()));

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- businesses (public discovery goes through search RPCs, not the raw table) ---
create policy businesses_select_members on public.businesses
  for select to authenticated
  -- owner_id check is inline (not only via helper) so INSERT ... RETURNING
  -- works: the helper's snapshot cannot yet see the row being inserted.
  using (owner_id = (select auth.uid()) or public.is_business_member(id) or (select public.is_admin()));

create policy businesses_insert_owner on public.businesses
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('business_owner', 'admin')
        and p.anonymized_at is null
    )
  );

create policy businesses_update_owner on public.businesses
  for update to authenticated
  using (owner_id = (select auth.uid()) or (select public.is_admin()))
  with check (owner_id = (select auth.uid()) or (select public.is_admin()));

-- staff_members ---------------------------------------------------------------
create policy staff_select_members on public.staff_members
  for select to authenticated
  using (public.is_business_member(business_id) or (select public.is_admin()));

create policy staff_insert_owner on public.staff_members
  for insert to authenticated
  with check (public.is_business_owner(business_id));

create policy staff_update_owner_or_self on public.staff_members
  for update to authenticated
  using (public.is_business_owner(business_id) or profile_id = (select auth.uid()) or (select public.is_admin()))
  with check (public.is_business_owner(business_id) or profile_id = (select auth.uid()) or (select public.is_admin()));

create policy staff_delete_owner on public.staff_members
  for delete to authenticated
  using (public.is_business_owner(business_id) and profile_id is distinct from (select auth.uid()));

-- services --------------------------------------------------------------------
create policy services_select_public on public.services
  for select to anon, authenticated
  using (
    (is_active and public.is_business_public(business_id))
    or public.is_business_member(business_id)
  );

create policy services_insert_owner on public.services
  for insert to authenticated
  with check (public.is_business_owner(business_id));

create policy services_update_owner on public.services
  for update to authenticated
  using (public.is_business_owner(business_id))
  with check (public.is_business_owner(business_id));

create policy services_delete_owner on public.services
  for delete to authenticated
  using (public.is_business_owner(business_id));

-- appointments (read-only via RLS; all writes through validated RPCs) ---------
create policy appointments_select on public.appointments
  for select to authenticated
  using (
    client_id = (select auth.uid())
    or public.is_business_member(business_id)
    or (select public.is_admin())
  );

-- appointment_quotes ----------------------------------------------------------
create policy quotes_select on public.appointment_quotes
  for select to authenticated
  using (
    public.is_business_member(business_id)
    or exists (
      select 1 from public.appointments a
      where a.id = appointment_id and a.client_id = (select auth.uid())
    )
    or (select public.is_admin())
  );

-- appointment_events ----------------------------------------------------------
create policy events_select on public.appointment_events
  for select to authenticated
  using (
    public.is_business_member(business_id)
    or exists (
      select 1 from public.appointments a
      where a.id = appointment_id and a.client_id = (select auth.uid())
    )
    or (select public.is_admin())
  );

-- client_notes (metadata only; bodies decrypt via audited RPC) -----------------
create policy client_notes_select_authorized on public.client_notes
  for select to authenticated
  using (public.can_view_client_notes(business_id));

-- transactions ----------------------------------------------------------------
create policy transactions_select on public.transactions
  for select to authenticated
  using (
    client_id = (select auth.uid())
    or public.is_business_owner(business_id)
    or (type = 'tip' and staff_id = public.current_staff_id(business_id))
    or (select public.is_admin())
  );

-- staff_tips ------------------------------------------------------------------
create policy tips_select on public.staff_tips
  for select to authenticated
  using (
    public.is_business_owner(business_id)
    or staff_id = public.current_staff_id(business_id)
    or (select public.is_admin())
  );

create policy tips_insert_owner on public.staff_tips
  for insert to authenticated
  with check (
    public.is_business_owner(business_id)
    and method <> 'in_app'                   -- in-app tips only via payment webhook
    and recorded_by = (select auth.uid())
  );

-- payment_methods -------------------------------------------------------------
create policy payment_methods_select_own on public.payment_methods
  for select to authenticated
  using (client_id = (select auth.uid()));

create policy payment_methods_delete_own on public.payment_methods
  for delete to authenticated
  using (client_id = (select auth.uid()));

-- webhook_events: NO policies (service_role only) ----------------------------

-- audit_logs ------------------------------------------------------------------
create policy audit_select on public.audit_logs
  for select to authenticated
  using (
    (select public.is_admin())
    or (business_id is not null and public.is_business_owner(business_id))
  );
