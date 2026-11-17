-- =============================================================================
-- Khula — 0600 Platform wiring + least-privilege GRANTS
--   * Storage buckets & object policies
--   * Realtime publication (live booking tracker)
--   * Vault encryption keys (generated in-database, never committed)
--   * pg_cron schedules
--   * Table / column / function privileges (deny-by-default)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Storage
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars',        'avatars',        true, 2097152, array['image/jpeg', 'image/png', 'image/webp']),
  ('business-media', 'business-media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- avatars/<auth.uid()>/<file>
create policy "avatars_insert_own_folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars_update_own_folder" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "avatars_delete_own_folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- business-media/<business_id>/<file> — owners only
create policy "business_media_insert_owner" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'business-media'
              and public.is_business_owner(public.try_uuid((storage.foldername(name))[1])));

create policy "business_media_update_owner" on storage.objects
  for update to authenticated
  using (bucket_id = 'business-media'
         and public.is_business_owner(public.try_uuid((storage.foldername(name))[1])))
  with check (bucket_id = 'business-media'
              and public.is_business_owner(public.try_uuid((storage.foldername(name))[1])));

create policy "business_media_delete_owner" on storage.objects
  for delete to authenticated
  using (bucket_id = 'business-media'
         and public.is_business_owner(public.try_uuid((storage.foldername(name))[1])));

-- -----------------------------------------------------------------------------
-- Realtime: postgres_changes respects RLS, so clients only receive their own rows.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.appointments, public.appointment_quotes, public.appointment_events;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Vault: random 256-bit keys created inside the database. Rotate by creating
-- a new secret + bumping client_notes.key_version (re-encrypt job).
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'vault') then
    if not exists (select 1 from vault.secrets where name = 'client_notes_key') then
      perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'base64'),
                                  'client_notes_key', 'AES-256 key for public.client_notes');
    end if;
    if not exists (select 1 from vault.secrets where name = 'payment_tokens_key') then
      perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'base64'),
                                  'payment_tokens_key', 'AES-256 key for public.payment_methods');
    end if;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- pg_cron
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('khula-expire-holds',    '*/5 * * * *', 'select public.expire_stale_holds()');
    perform cron.schedule('khula-popia-retention', '15 2 * * *',  'select public.purge_expired_personal_data()');
  end if;
end;
$$;

-- =============================================================================
-- PRIVILEGES — deny by default, then grant precisely.
-- =============================================================================

-- Tables ----------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;

grant select on public.categories to anon, authenticated;
grant select on public.services   to anon, authenticated;

grant select on
  public.profiles, public.businesses, public.staff_members, public.appointments,
  public.appointment_quotes, public.appointment_events, public.transactions,
  public.staff_tips, public.audit_logs
to authenticated;

-- profiles: users edit only harmless fields (role is NOT updatable).
grant update (full_name, phone, avatar_url, preference_notes, marketing_opt_in)
  on public.profiles to authenticated;

-- businesses: owners cannot touch verification, fees or payout codes.
grant insert (owner_id, name, slug, description, category_id, service_model,
              address_line1, address_line2, suburb, city, province, postal_code,
              location, travel_radius_km, phone, email, logo_url)
  on public.businesses to authenticated;
grant update (name, description, category_id, service_model,
              address_line1, address_line2, suburb, city, province, postal_code,
              location, travel_radius_km, phone, email, logo_url, is_active)
  on public.businesses to authenticated;

-- staff_members: profile_id / invite_accepted_at are never client-writable.
grant insert (business_id, display_name, role_title, avatar_url, invite_email,
              commission_bps, working_hours, can_view_client_notes, can_manage_bookings, is_active)
  on public.staff_members to authenticated;
grant update (display_name, role_title, avatar_url, invite_email,
              commission_bps, working_hours, can_view_client_notes, can_manage_bookings, is_active)
  on public.staff_members to authenticated;
grant delete on public.staff_members to authenticated;

grant insert (business_id, category_id, title, description, pricing_model, price_cents,
              duration_minutes, buffer_minutes, deposit_percent, is_active, sort_order)
  on public.services to authenticated;
grant update (category_id, title, description, pricing_model, price_cents,
              duration_minutes, buffer_minutes, deposit_percent, is_active, sort_order)
  on public.services to authenticated;
grant delete on public.services to authenticated;

grant insert (business_id, staff_id, appointment_id, amount_cents, method, note, recorded_by)
  on public.staff_tips to authenticated;

-- client_notes: metadata only — ciphertext is never selectable.
grant select (id, business_id, client_id, author_id, key_version, created_at, updated_at)
  on public.client_notes to authenticated;

-- payment_methods: display fields only — the token is never selectable.
grant select (id, client_id, provider, brand, last4, exp_month, exp_year, bank, is_default, created_at)
  on public.payment_methods to authenticated;
grant delete on public.payment_methods to authenticated;

-- webhook_events: no grants to anon/authenticated at all.

-- Sequences (identity columns written by definer functions only) -------------
revoke all on all sequences in schema public from anon, authenticated;

-- Functions -------------------------------------------------------------------
-- Postgres grants EXECUTE to PUBLIC by default; Supabase additionally grants
-- to anon/authenticated. Revoke everything, then allow-list.
revoke all on all functions in schema public from public, anon, authenticated;

-- Future functions: secure-by-default (each new migration must grant explicitly).
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

-- Used inside CHECK constraints / RLS policies / invoker triggers: the
-- calling role needs EXECUTE for these to evaluate.
grant execute on function
  public.app_timezone(),
  public.is_plain_text(text),
  public.is_valid_working_hours(jsonb),
  public.is_privileged_context(),
  public.is_service_role(),
  public.is_admin(),
  public.is_business_owner(uuid),
  public.is_business_member(uuid),
  public.can_manage_bookings(uuid),
  public.can_view_client_notes(uuid),
  public.current_staff_id(uuid),
  public.is_business_public(uuid),
  public.can_view_profile(uuid),
  public.try_uuid(text),
  public.is_valid_appointment_transition(public.appointment_status, public.appointment_status)
to anon, authenticated;

-- Public discovery
grant execute on function
  public.search_businesses(double precision, double precision, double precision, text, text, public.service_model, integer, integer),
  public.get_business_public(uuid),
  public.list_bookable_staff(uuid),
  public.get_available_slots(uuid, date, uuid)
to anon, authenticated;

-- Signed-in users (each function authorises the caller internally)
grant execute on function
  public.book_appointment(uuid, timestamptz, uuid, jsonb, text, uuid, public.booking_source),
  public.create_walk_in_appointment(uuid, uuid, uuid, timestamptz, text, text, integer),
  public.update_appointment_status(uuid, public.appointment_status, text),
  public.update_job_progress(uuid, public.job_progress),
  public.reschedule_appointment(uuid, timestamptz, uuid),
  public.submit_quote(uuid, integer, text, integer, timestamptz, uuid),
  public.respond_to_quote(uuid, boolean),
  public.accept_staff_invite(uuid),
  public.add_client_note(uuid, uuid, text),
  public.get_client_notes(uuid, uuid),
  public.delete_client_note(uuid),
  public.get_business_dashboard_stats(uuid, date),
  public.get_staff_earnings(uuid, date, date),
  public.export_client_data(uuid),
  public.anonymize_client(uuid, text, boolean),
  public.admin_set_user_role(uuid, public.user_role),
  public.admin_set_business_verification(uuid, boolean, integer),
  public.verify_audit_chain()
to authenticated;

-- Server-side only (Edge Functions / trusted backend holding the service key)
grant execute on function
  public.prepare_payment(uuid, uuid, public.transaction_type, integer, public.payment_provider),
  public.apply_payment_success(public.payment_provider, text, text, bigint, text, timestamptz, text, bigint, text, jsonb, boolean),
  public.apply_payment_refund(public.payment_provider, text, bigint, text),
  public.get_payment_authorization(uuid, uuid),
  public.set_business_payout_account(uuid, text, text, text),
  public.expire_stale_holds(),
  public.purge_expired_personal_data(),
  public.anonymize_client(uuid, text, boolean),
  public.export_client_data(uuid),
  public.verify_audit_chain(),
  public.write_audit_log(text, text, text, uuid, jsonb)
to service_role;
