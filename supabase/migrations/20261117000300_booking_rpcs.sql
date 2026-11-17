-- =============================================================================
-- Khula — 0300 Booking engine RPCs
--
-- Every write to appointments / quotes / notes goes through these functions.
-- They run SECURITY DEFINER with an empty search_path, authorise the caller
-- explicitly, recompute prices server-side (never trust client prices) and
-- map failures to PostgREST HTTP codes via SQLSTATE 'PTxxx'.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Geo helpers
-- -----------------------------------------------------------------------------
create or replace function public.sa_point(p_lat double precision, p_lng double precision)
returns extensions.geography
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_lat is null or p_lng is null then
    raise exception 'LOCATION_REQUIRED' using errcode = 'PT400';
  end if;
  -- Generous bounding box for South Africa (incl. Marion Island excluded).
  if p_lat not between -35.5 and -21.5 or p_lng not between 16.0 and 33.5 then
    raise exception 'LOCATION_OUTSIDE_SOUTH_AFRICA' using errcode = 'PT400';
  end if;
  return extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
end;
$$;

-- -----------------------------------------------------------------------------
-- Public discovery (anon + authenticated). Never exposes the base address or
-- exact coordinates of mobile_onsite operators (often their home — POPIA).
-- -----------------------------------------------------------------------------
create or replace function public.search_businesses(
  p_lat            double precision default null,
  p_lng            double precision default null,
  p_radius_km      double precision default 25,
  p_category       text default null,
  p_query          text default null,
  p_service_model  public.service_model default null,
  p_limit          integer default 20,
  p_offset         integer default 0
)
returns table (
  id                   uuid,
  name                 text,
  slug                 text,
  description          text,
  category_slug        text,
  category_name        text,
  service_model        public.service_model,
  suburb               text,
  city                 text,
  province             public.sa_province,
  address_line1        text,
  logo_url             text,
  is_verified          boolean,
  travel_radius_km     numeric,
  distance_km          double precision,
  services_your_area   boolean,
  min_price_cents      integer,
  has_instant_book     boolean,
  has_quote_services   boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_point  extensions.geography;
  v_like   text;
begin
  if (p_lat is null) <> (p_lng is null) then
    raise exception 'LAT_LNG_PAIR_REQUIRED' using errcode = 'PT400';
  end if;
  if p_lat is not null then
    v_point := public.sa_point(p_lat, p_lng);
  end if;

  p_limit     := least(greatest(coalesce(p_limit, 20), 1), 50);
  p_offset    := least(greatest(coalesce(p_offset, 0), 0), 1000);
  p_radius_km := least(greatest(coalesce(p_radius_km, 25), 1), 200);
  p_query     := nullif(btrim(left(p_query, 80)), '');
  if p_query is not null then
    -- escape LIKE metacharacters so user input is matched literally
    v_like := '%' || replace(replace(replace(p_query, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  return query
  select
    b.id,
    b.name,
    b.slug,
    b.description,
    c.slug,
    c.name,
    b.service_model,
    b.suburb,
    b.city,
    b.province,
    case when b.service_model = 'fixed_location' then b.address_line1 end,
    b.logo_url,
    b.is_verified,
    b.travel_radius_km,
    case when v_point is null then null
         else round((extensions.st_distance(b.location, v_point) / 1000.0)::numeric, 1)::double precision end,
    case when v_point is null or b.service_model <> 'mobile_onsite' then null
         else extensions.st_dwithin(b.location, v_point, (b.travel_radius_km * 1000)::double precision) end,
    s.min_price,
    coalesce(s.has_instant, false),
    coalesce(s.has_quote, false)
  from public.businesses b
  join public.categories c on c.id = b.category_id
  left join lateral (
    select min(sv.price_cents)                          as min_price,
           bool_or(sv.pricing_model = 'instant_book')   as has_instant,
           bool_or(sv.pricing_model = 'quote_required') as has_quote
    from public.services sv
    where sv.business_id = b.id and sv.is_active
  ) s on true
  where b.is_active
    and (p_category is null or c.slug = p_category)
    and (p_service_model is null or b.service_model = p_service_model)
    and (v_like is null or b.name ilike v_like or c.name ilike v_like)
    and (
      v_point is null
      or case
           -- mobile operators appear if YOU are inside THEIR travel radius
           when b.service_model = 'mobile_onsite'
             then extensions.st_dwithin(b.location, v_point, (b.travel_radius_km * 1000)::double precision)
           else extensions.st_dwithin(b.location, v_point, p_radius_km * 1000)
         end
    )
  order by
    case when v_point is null then 0 else extensions.st_distance(b.location, v_point) end,
    b.is_verified desc,
    b.name
  limit p_limit offset p_offset;
end;
$$;

create or replace function public.get_business_public(p_business_id uuid)
returns table (
  id                uuid,
  name              text,
  slug              text,
  description       text,
  category_slug     text,
  category_name     text,
  service_model     public.service_model,
  suburb            text,
  city              text,
  province          public.sa_province,
  address_line1     text,
  logo_url          text,
  is_verified       boolean,
  travel_radius_km  numeric,
  latitude          double precision,   -- exact for fixed_location; ~1 km fuzzed for mobile_onsite
  longitude         double precision,
  accepts_payments  boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    b.id, b.name, b.slug, b.description, c.slug, c.name, b.service_model,
    b.suburb, b.city, b.province,
    case when b.service_model = 'fixed_location' then b.address_line1 end,
    b.logo_url, b.is_verified, b.travel_radius_km,
    case when b.service_model = 'fixed_location'
         then extensions.st_y(b.location::extensions.geometry)
         else round(extensions.st_y(b.location::extensions.geometry)::numeric, 2)::double precision end,
    case when b.service_model = 'fixed_location'
         then extensions.st_x(b.location::extensions.geometry)
         else round(extensions.st_x(b.location::extensions.geometry)::numeric, 2)::double precision end,
    b.paystack_subaccount_code is not null
  from public.businesses b
  join public.categories c on c.id = b.category_id
  where b.id = p_business_id and b.is_active;
$$;

create or replace function public.list_bookable_staff(p_business_id uuid)
returns table (staff_id uuid, display_name text, role_title text, avatar_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.display_name, s.role_title, s.avatar_url
  from public.staff_members s
  join public.businesses b on b.id = s.business_id
  where s.business_id = p_business_id
    and s.is_active
    and b.is_active
    and s.working_hours <> '{}'::jsonb
  order by s.display_name;
$$;

-- -----------------------------------------------------------------------------
-- Availability
-- -----------------------------------------------------------------------------
create or replace function public.weekday_key(p_date date)
returns text
language sql
immutable
set search_path = ''
as $$ select (array['mon','tue','wed','thu','fri','sat','sun'])[extract(isodow from p_date)::int] $$;

create or replace function public.is_within_working_hours(
  p_staff_id uuid,
  p_starts   timestamptz,
  p_ends     timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz          text := public.app_timezone();
  v_local_start timestamp := p_starts at time zone v_tz;
  v_local_end   timestamp := p_ends at time zone v_tz;
  v_hours       jsonb;
begin
  if v_local_end::date <> v_local_start::date then
    return false;   -- no overnight bookings
  end if;

  select s.working_hours -> public.weekday_key(v_local_start::date)
    into v_hours
  from public.staff_members s
  where s.id = p_staff_id and s.is_active;

  return exists (
    select 1
    from jsonb_array_elements(coalesce(v_hours, '[]'::jsonb)) iv
    where (iv ->> 'start')::time <= v_local_start::time
      and (iv ->> 'end')::time   >= v_local_end::time
  );
end;
$$;

-- Returns free slots without revealing anything about other clients' bookings.
create or replace function public.get_available_slots(
  p_service_id uuid,
  p_date       date,
  p_staff_id   uuid default null
)
returns table (staff_id uuid, staff_name text, slot_start timestamptz, slot_end timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tz         text := public.app_timezone();
  v_today      date := (now() at time zone public.app_timezone())::date;
  v_business   uuid;
  v_duration   integer;
  v_buffer     integer;
  v_dow        text := public.weekday_key(p_date);
  v_min_start  timestamptz := now() + interval '30 minutes';
begin
  select s.business_id, s.duration_minutes, s.buffer_minutes
    into v_business, v_duration, v_buffer
  from public.services s
  join public.businesses b on b.id = s.business_id
  where s.id = p_service_id and s.is_active and b.is_active;

  if v_business is null then
    raise exception 'SERVICE_NOT_FOUND' using errcode = 'PT404';
  end if;
  if p_date is null or p_date < v_today or p_date > v_today + 90 then
    raise exception 'DATE_OUT_OF_RANGE' using errcode = 'PT400';
  end if;

  return query
  with staff as (
    select sm.id, sm.display_name, sm.working_hours
    from public.staff_members sm
    where sm.business_id = v_business
      and sm.is_active
      and (p_staff_id is null or sm.id = p_staff_id)
  ),
  windows as (
    select st.id as sid,
           st.display_name as sname,
           ((p_date + (iv ->> 'start')::time) at time zone v_tz) as w_start,
           ((p_date + (iv ->> 'end')::time)   at time zone v_tz) as w_end
    from staff st
    cross join lateral jsonb_array_elements(coalesce(st.working_hours -> v_dow, '[]'::jsonb)) iv
  ),
  candidates as (
    select w.sid, w.sname, gs as c_start, gs + make_interval(mins => v_duration) as c_end
    from windows w
    cross join lateral generate_series(
      w.w_start,
      w.w_end - make_interval(mins => v_duration),
      interval '15 minutes'
    ) gs
  )
  select c.sid, c.sname, c.c_start, c.c_end
  from candidates c
  where c.c_start >= v_min_start
    and not exists (
      select 1 from public.appointments a
      where a.staff_id = c.sid
        and a.status in ('requested', 'quoted', 'confirmed')
        and tstzrange(a.starts_at, a.blocked_until, '[)')
            && tstzrange(c.c_start, c.c_end + make_interval(mins => v_buffer), '[)')
    )
  order by c.c_start, c.sname;
end;
$$;

-- -----------------------------------------------------------------------------
-- Client booking
-- -----------------------------------------------------------------------------
create or replace function public.book_appointment(
  p_service_id       uuid,
  p_starts_at        timestamptz,
  p_staff_id         uuid default null,
  p_address          jsonb default null,   -- {line1,line2?,suburb,city,postal_code,lat,lng} for mobile_onsite
  p_client_message   text default null,
  p_idempotency_key  uuid default null,
  p_source           public.booking_source default 'app'
)
returns public.appointments
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid             uuid := auth.uid();
  v_service         public.services;
  v_business        public.businesses;
  v_appt            public.appointments;
  v_point           extensions.geography;
  v_ends            timestamptz;
  v_staff_id        uuid := p_staff_id;
  v_price           integer;
  v_deposit         integer := 0;
  v_status          public.appointment_status;
  v_deposit_status  public.deposit_status := 'not_required';
  v_hold            timestamptz;
  v_message         text := nullif(btrim(left(p_client_message, 1000)), '');
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'PT401';
  end if;
  if p_source = 'walk_in' then
    raise exception 'INVALID_SOURCE' using errcode = 'PT400';
  end if;
  if exists (select 1 from public.profiles where id = v_uid and anonymized_at is not null) then
    raise exception 'ACCOUNT_CLOSED' using errcode = 'PT403';
  end if;

  -- Idempotent retries (mobile networks drop responses) return the original booking.
  if p_idempotency_key is not null then
    select * into v_appt from public.appointments
    where client_id = v_uid and idempotency_key = p_idempotency_key;
    if found then
      return v_appt;
    end if;
  end if;

  -- Database-level anti-spam (backstop for the Upstash edge rate limiter).
  if (select count(*) from public.appointments
      where client_id = v_uid and status in ('requested', 'quoted')) >= 5 then
    raise exception 'TOO_MANY_OPEN_REQUESTS' using errcode = 'PT429';
  end if;
  if (select count(*) from public.appointments
      where client_id = v_uid and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'BOOKING_RATE_LIMITED' using errcode = 'PT429';
  end if;

  select * into v_service from public.services where id = p_service_id and is_active;
  if not found then
    raise exception 'SERVICE_NOT_FOUND' using errcode = 'PT404';
  end if;
  select * into v_business from public.businesses where id = v_service.business_id and is_active;
  if not found then
    raise exception 'SERVICE_NOT_FOUND' using errcode = 'PT404';
  end if;

  if p_starts_at is null
     or p_starts_at < now() + interval '30 minutes'
     or p_starts_at > now() + interval '90 days' then
    raise exception 'START_TIME_OUT_OF_RANGE' using errcode = 'PT400';
  end if;
  v_ends := p_starts_at + make_interval(mins => v_service.duration_minutes);

  -- Location rules ------------------------------------------------------------
  if v_business.service_model = 'mobile_onsite' then
    if p_address is null or jsonb_typeof(p_address) <> 'object' then
      raise exception 'ADDRESS_REQUIRED' using errcode = 'PT400';
    end if;
    if coalesce(char_length(btrim(p_address ->> 'line1')), 0) not between 2 and 200
       or coalesce(char_length(btrim(p_address ->> 'suburb')), 0) not between 2 and 80
       or coalesce(char_length(btrim(p_address ->> 'city')), 0) not between 2 and 80
       or coalesce(p_address ->> 'postal_code', '') !~ '^[0-9]{4}$'
       or jsonb_typeof(p_address -> 'lat') <> 'number'
       or jsonb_typeof(p_address -> 'lng') <> 'number' then
      raise exception 'ADDRESS_INVALID' using errcode = 'PT400';
    end if;
    v_point := public.sa_point((p_address ->> 'lat')::double precision, (p_address ->> 'lng')::double precision);
    if not extensions.st_dwithin(v_business.location, v_point, (v_business.travel_radius_km * 1000)::double precision) then
      raise exception 'OUTSIDE_TRAVEL_RADIUS' using errcode = 'PT422';
    end if;
  elsif p_address is not null then
    raise exception 'ADDRESS_NOT_ALLOWED_FOR_FIXED_LOCATION' using errcode = 'PT400';
  end if;

  -- Staff ----------------------------------------------------------------------
  if v_staff_id is not null and not exists (
    select 1 from public.staff_members
    where id = v_staff_id and business_id = v_business.id and is_active
  ) then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'PT404';
  end if;

  -- Pricing (server-authoritative) ---------------------------------------------
  if v_service.pricing_model = 'instant_book' then
    if v_staff_id is null then
      -- "Any available professional": pick the first free lane for this slot.
      select s.staff_id into v_staff_id
      from public.get_available_slots(
        p_service_id, (p_starts_at at time zone public.app_timezone())::date, null
      ) s
      where s.slot_start = p_starts_at
      limit 1;
      if v_staff_id is null then
        raise exception 'SLOT_UNAVAILABLE' using errcode = 'PT409';
      end if;
    elsif not public.is_within_working_hours(v_staff_id, p_starts_at, v_ends) then
      raise exception 'OUTSIDE_WORKING_HOURS' using errcode = 'PT409';
    end if;

    v_price   := v_service.price_cents;
    v_deposit := round(v_price * v_service.deposit_percent / 100.0)::integer;
    if v_deposit > 0 then
      v_status         := 'requested';
      v_deposit_status := 'pending';
      v_hold           := now() + interval '15 minutes';
    else
      v_status := 'confirmed';
    end if;
  else
    -- quote_required: provider prices the job; preferred time is held if a lane was chosen
    if v_staff_id is not null and not public.is_within_working_hours(v_staff_id, p_starts_at, v_ends) then
      raise exception 'OUTSIDE_WORKING_HOURS' using errcode = 'PT409';
    end if;
    v_price  := null;
    v_status := 'requested';
  end if;

  begin
    insert into public.appointments (
      business_id, service_id, staff_id, client_id, source, status,
      starts_at, ends_at, buffer_minutes,
      is_mobile, client_address_line1, client_address_line2, client_suburb, client_city,
      client_postal_code, client_location, client_message,
      total_price_cents, deposit_cents, deposit_status, hold_expires_at, idempotency_key
    )
    values (
      v_business.id, v_service.id, v_staff_id, v_uid, p_source, v_status,
      p_starts_at, v_ends, v_service.buffer_minutes,
      v_business.service_model = 'mobile_onsite',
      nullif(btrim(p_address ->> 'line1'), ''),
      nullif(btrim(p_address ->> 'line2'), ''),
      nullif(btrim(p_address ->> 'suburb'), ''),
      nullif(btrim(p_address ->> 'city'), ''),
      p_address ->> 'postal_code',
      v_point,
      v_message,
      v_price, v_deposit, v_deposit_status, v_hold, p_idempotency_key
    )
    returning * into v_appt;
  exception
    when exclusion_violation then
      raise exception 'SLOT_UNAVAILABLE' using errcode = 'PT409';
    when unique_violation then
      -- concurrent retry with the same idempotency key
      select * into v_appt from public.appointments
      where client_id = v_uid and idempotency_key = p_idempotency_key;
      if not found then
        raise;
      end if;
  end;

  return v_appt;
end;
$$;

-- -----------------------------------------------------------------------------
-- Provider: walk-ins
-- -----------------------------------------------------------------------------
create or replace function public.create_walk_in_appointment(
  p_business_id    uuid,
  p_service_id     uuid,
  p_staff_id       uuid,
  p_starts_at      timestamptz,
  p_walk_in_name   text,
  p_walk_in_phone  text default null,
  p_price_cents    integer default null
)
returns public.appointments
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_service public.services;
  v_appt    public.appointments;
  v_price   integer;
begin
  if not public.can_manage_bookings(p_business_id) then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  select * into v_service from public.services
  where id = p_service_id and business_id = p_business_id;
  if not found then
    raise exception 'SERVICE_NOT_FOUND' using errcode = 'PT404';
  end if;

  if not exists (select 1 from public.staff_members where id = p_staff_id and business_id = p_business_id and is_active) then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'PT404';
  end if;

  if p_starts_at is null
     or p_starts_at < now() - interval '12 hours'
     or p_starts_at > now() + interval '90 days' then
    raise exception 'START_TIME_OUT_OF_RANGE' using errcode = 'PT400';
  end if;

  v_price := coalesce(p_price_cents, v_service.price_cents);
  if v_price is null or v_price < 0 or v_price > 100000000 then
    raise exception 'PRICE_REQUIRED' using errcode = 'PT400';
  end if;

  begin
    insert into public.appointments (
      business_id, service_id, staff_id, client_id, walk_in_name, walk_in_phone,
      source, status, starts_at, ends_at, buffer_minutes, total_price_cents
    )
    values (
      p_business_id, p_service_id, p_staff_id, null,
      nullif(btrim(left(p_walk_in_name, 120)), ''),
      p_walk_in_phone,
      'walk_in', 'confirmed',
      p_starts_at, p_starts_at + make_interval(mins => v_service.duration_minutes),
      v_service.buffer_minutes, v_price
    )
    returning * into v_appt;
  exception when exclusion_violation then
    raise exception 'SLOT_UNAVAILABLE' using errcode = 'PT409';
  end;

  return v_appt;
end;
$$;

-- -----------------------------------------------------------------------------
-- Status changes (provider + client cancel)
-- -----------------------------------------------------------------------------
create or replace function public.update_appointment_status(
  p_appointment_id uuid,
  p_status         public.appointment_status,
  p_reason         text default null
)
returns public.appointments
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_appt      public.appointments;
  v_is_staff  boolean;
  v_is_client boolean;
  v_reason    text := nullif(btrim(left(p_reason, 500)), '');
  v_deposit   public.deposit_status;
begin
  select * into v_appt from public.appointments where id = p_appointment_id for update;
  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'PT404';
  end if;

  v_is_staff  := public.can_manage_bookings(v_appt.business_id);
  v_is_client := v_appt.client_id is not null and v_appt.client_id = v_uid;

  if not (v_is_staff or v_is_client) then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'PT404';   -- don't leak existence
  end if;

  if p_status in ('requested', 'quoted') then
    raise exception 'USE_QUOTE_FLOW' using errcode = 'PT400';
  end if;

  if v_is_client and not v_is_staff and p_status <> 'cancelled' then
    raise exception 'CLIENTS_MAY_ONLY_CANCEL' using errcode = 'PT403';
  end if;

  if p_status = 'completed' and v_appt.starts_at > now() then
    raise exception 'CANNOT_COMPLETE_FUTURE_APPOINTMENT' using errcode = 'PT409';
  end if;

  if p_status = 'confirmed' and v_appt.total_price_cents is null then
    raise exception 'PRICE_NOT_AGREED' using errcode = 'PT409';
  end if;

  v_deposit := v_appt.deposit_status;
  if p_status = 'cancelled' and v_appt.deposit_status = 'paid' then
    -- Cancellation policy: client cancelling < 24h before start forfeits the
    -- deposit; any provider cancellation (or early client cancel) is refunded.
    if v_is_client and not v_is_staff and v_appt.starts_at < now() + interval '24 hours' then
      v_deposit := 'forfeited';
    else
      v_deposit := 'refunded';
      update public.transactions
         set requires_refund = true
       where appointment_id = v_appt.id and type = 'deposit' and status = 'success';
    end if;
  end if;

  update public.appointments
     set status              = p_status,
         deposit_status      = v_deposit,
         cancelled_by        = case when p_status = 'cancelled' then v_uid else cancelled_by end,
         cancellation_reason = case when p_status = 'cancelled' then v_reason else cancellation_reason end
   where id = v_appt.id
  returning * into v_appt;

  return v_appt;
end;
$$;

create or replace function public.update_job_progress(
  p_appointment_id uuid,
  p_progress       public.job_progress
)
returns public.appointments
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_appt public.appointments;
begin
  select * into v_appt from public.appointments where id = p_appointment_id for update;
  if not found or not (
       public.can_manage_bookings(v_appt.business_id)
       or (v_appt.staff_id is not null and v_appt.staff_id = public.current_staff_id(v_appt.business_id))
     ) then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_appt.status <> 'confirmed' then
    raise exception 'PROGRESS_REQUIRES_CONFIRMED' using errcode = 'PT409';
  end if;
  if p_progress = 'finished' or p_progress <= v_appt.progress then
    raise exception 'PROGRESS_MUST_MOVE_FORWARD' using errcode = 'PT409';
  end if;
  if p_progress = 'en_route' and not v_appt.is_mobile then
    raise exception 'EN_ROUTE_ONLY_FOR_MOBILE_JOBS' using errcode = 'PT400';
  end if;

  update public.appointments set progress = p_progress where id = v_appt.id returning * into v_appt;
  return v_appt;
end;
$$;

create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_starts_at      timestamptz,
  p_staff_id       uuid default null
)
returns public.appointments
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_appt     public.appointments;
  v_staff_id uuid;
begin
  select * into v_appt from public.appointments where id = p_appointment_id for update;
  if not found or not public.can_manage_bookings(v_appt.business_id) then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_appt.status not in ('requested', 'quoted', 'confirmed') then
    raise exception 'APPOINTMENT_CLOSED' using errcode = 'PT409';
  end if;
  if p_starts_at is null or p_starts_at > now() + interval '90 days' or p_starts_at < now() - interval '12 hours' then
    raise exception 'START_TIME_OUT_OF_RANGE' using errcode = 'PT400';
  end if;

  v_staff_id := coalesce(p_staff_id, v_appt.staff_id);
  if v_staff_id is not null and not exists (
    select 1 from public.staff_members where id = v_staff_id and business_id = v_appt.business_id and is_active
  ) then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'PT404';
  end if;

  begin
    update public.appointments
       set starts_at = p_starts_at,
           ends_at   = p_starts_at + (v_appt.ends_at - v_appt.starts_at),
           staff_id  = v_staff_id
     where id = v_appt.id
    returning * into v_appt;
  exception when exclusion_violation then
    raise exception 'SLOT_UNAVAILABLE' using errcode = 'PT409';
  end;
  return v_appt;
end;
$$;

-- -----------------------------------------------------------------------------
-- Quotes
-- -----------------------------------------------------------------------------
create or replace function public.submit_quote(
  p_appointment_id      uuid,
  p_amount_cents        integer,
  p_message             text default null,
  p_valid_hours         integer default 72,
  p_proposed_starts_at  timestamptz default null,
  p_proposed_staff_id   uuid default null
)
returns public.appointment_quotes
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_appt    public.appointments;
  v_pricing public.pricing_model;
  v_quote   public.appointment_quotes;
begin
  select * into v_appt from public.appointments where id = p_appointment_id for update;
  if not found or not public.can_manage_bookings(v_appt.business_id) then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_appt.status not in ('requested', 'quoted') or v_appt.deposit_status = 'pending' then
    raise exception 'APPOINTMENT_NOT_QUOTABLE' using errcode = 'PT409';
  end if;

  select pricing_model into v_pricing from public.services where id = v_appt.service_id;
  if v_pricing <> 'quote_required' then
    raise exception 'SERVICE_IS_INSTANT_BOOK' using errcode = 'PT400';
  end if;
  if p_amount_cents is null or p_amount_cents < 100 or p_amount_cents > 100000000 then
    raise exception 'INVALID_AMOUNT' using errcode = 'PT400';
  end if;
  if p_valid_hours is null or p_valid_hours not between 1 and 336 then
    raise exception 'INVALID_VALIDITY' using errcode = 'PT400';
  end if;

  -- Reschedule / assign a lane if the provider proposed one (holds the slot).
  if p_proposed_starts_at is not null or p_proposed_staff_id is not null then
    begin
      update public.appointments
         set starts_at = coalesce(p_proposed_starts_at, starts_at),
             ends_at   = coalesce(p_proposed_starts_at, starts_at) + (ends_at - starts_at),
             staff_id  = coalesce(p_proposed_staff_id, staff_id)
       where id = v_appt.id;
    exception when exclusion_violation then
      raise exception 'SLOT_UNAVAILABLE' using errcode = 'PT409';
    end;
  end if;

  update public.appointment_quotes
     set status = 'superseded'
   where appointment_id = v_appt.id and status = 'pending';

  insert into public.appointment_quotes (
    appointment_id, business_id, created_by, amount_cents, message,
    proposed_starts_at, proposed_staff_id, valid_until
  )
  values (
    v_appt.id, v_appt.business_id, auth.uid(), p_amount_cents,
    nullif(btrim(left(p_message, 2000)), ''),
    p_proposed_starts_at, p_proposed_staff_id,
    now() + make_interval(hours => p_valid_hours)
  )
  returning * into v_quote;

  if v_appt.status <> 'quoted' then
    update public.appointments set status = 'quoted' where id = v_appt.id;
  end if;

  insert into public.appointment_events (appointment_id, business_id, actor_id, event_type, note)
  values (v_appt.id, v_appt.business_id, auth.uid(), 'quote_sent',
          'Quote R' || to_char(p_amount_cents / 100.0, 'FM999999990.00'));

  return v_quote;
end;
$$;

create or replace function public.respond_to_quote(
  p_quote_id uuid,
  p_accept   boolean
)
returns public.appointments
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_quote    public.appointment_quotes;
  v_appt     public.appointments;
  v_percent  smallint;
  v_deposit  integer;
begin
  select * into v_quote from public.appointment_quotes where id = p_quote_id for update;
  if not found then
    raise exception 'QUOTE_NOT_FOUND' using errcode = 'PT404';
  end if;

  select * into v_appt from public.appointments where id = v_quote.appointment_id for update;
  if v_appt.client_id is distinct from auth.uid() then
    raise exception 'QUOTE_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_quote.status <> 'pending' then
    raise exception 'QUOTE_NOT_PENDING' using errcode = 'PT409';
  end if;
  if v_quote.valid_until < now() then
    update public.appointment_quotes set status = 'expired' where id = v_quote.id;
    raise exception 'QUOTE_EXPIRED' using errcode = 'PT409';
  end if;
  if v_appt.status <> 'quoted' then
    raise exception 'APPOINTMENT_NOT_QUOTED' using errcode = 'PT409';
  end if;

  update public.appointment_quotes
     set status = case when p_accept then 'accepted'::public.quote_status else 'declined'::public.quote_status end,
         responded_at = now()
   where id = v_quote.id;

  insert into public.appointment_events (appointment_id, business_id, actor_id, event_type, note)
  values (v_appt.id, v_appt.business_id, auth.uid(), 'quote_responded',
          case when p_accept then 'Quote accepted' else 'Quote declined' end);

  if not p_accept then
    update public.appointments set status = 'requested' where id = v_appt.id returning * into v_appt;
    return v_appt;
  end if;

  select deposit_percent into v_percent from public.services where id = v_appt.service_id;
  v_deposit := round(v_quote.amount_cents * v_percent / 100.0)::integer;

  if v_deposit > 0 then
    update public.appointments
       set total_price_cents = v_quote.amount_cents,
           deposit_cents     = v_deposit,
           deposit_status    = 'pending',
           hold_expires_at   = now() + interval '30 minutes'
     where id = v_appt.id
    returning * into v_appt;            -- stays 'quoted' until the deposit webhook confirms
  else
    update public.appointments
       set total_price_cents = v_quote.amount_cents,
           status            = 'confirmed'
     where id = v_appt.id
    returning * into v_appt;
  end if;

  return v_appt;
end;
$$;

-- -----------------------------------------------------------------------------
-- Staff invitations
-- -----------------------------------------------------------------------------
create or replace function public.accept_staff_invite(p_staff_id uuid)
returns public.staff_members
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  v_staff  public.staff_members;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'PT401';
  end if;

  -- Only a CONFIRMED email may claim an invite (prevents invite hijacking).
  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null then
    raise exception 'EMAIL_NOT_CONFIRMED' using errcode = 'PT403';
  end if;

  update public.staff_members
     set profile_id = v_uid,
         invite_accepted_at = now()
   where id = p_staff_id
     and profile_id is null
     and is_active
     and lower(invite_email) = v_email
  returning * into v_staff;

  if not found then
    raise exception 'INVITE_NOT_FOUND' using errcode = 'PT404';
  end if;

  update public.profiles set role = 'staff' where id = v_uid and role = 'client';
  return v_staff;
end;
$$;

-- -----------------------------------------------------------------------------
-- Encrypted client notes (key lives in Supabase Vault, never in this repo)
-- -----------------------------------------------------------------------------
create or replace function public.vault_secret(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  select ds.decrypted_secret into v_secret
  from vault.decrypted_secrets ds
  where ds.name = p_name
  limit 1;
  if v_secret is null then
    raise exception 'ENCRYPTION_KEY_MISSING' using errcode = 'PT500';
  end if;
  return v_secret;
end;
$$;

create or replace function public.add_client_note(
  p_business_id uuid,
  p_client_id   uuid,
  p_body        text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_body text := btrim(p_body);
  v_id   uuid;
begin
  if not public.can_view_client_notes(p_business_id) then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  -- Purpose limitation: notes only about people who actually booked with you.
  if not exists (
    select 1 from public.appointments a
    where a.business_id = p_business_id and a.client_id = p_client_id
  ) then
    raise exception 'NOT_A_CLIENT_OF_THIS_BUSINESS' using errcode = 'PT403';
  end if;
  if v_body is null or char_length(v_body) not between 1 and 4000 or not public.is_plain_text(v_body) then
    raise exception 'INVALID_NOTE' using errcode = 'PT400';
  end if;

  insert into public.client_notes (business_id, client_id, author_id, body_ciphertext)
  values (
    p_business_id, p_client_id, auth.uid(),
    extensions.pgp_sym_encrypt(v_body, public.vault_secret('client_notes_key'), 'cipher-algo=aes256')
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.get_client_notes(
  p_business_id uuid,
  p_client_id   uuid
)
returns table (id uuid, author_id uuid, author_name text, body text, created_at timestamptz)
language plpgsql
volatile          -- writes an audit row
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_key text;
begin
  if not public.can_view_client_notes(p_business_id) then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  -- Every read of sensitive notes is attributable (POPIA accountability).
  perform public.write_audit_log(
    'client_notes.read', 'client', p_client_id::text, p_business_id, '{}'::jsonb
  );

  v_key := public.vault_secret('client_notes_key');
  return query
  select n.id, n.author_id, p.full_name,
         extensions.pgp_sym_decrypt(n.body_ciphertext, v_key),
         n.created_at
  from public.client_notes n
  left join public.profiles p on p.id = n.author_id
  where n.business_id = p_business_id and n.client_id = p_client_id
  order by n.created_at desc
  limit 200;
end;
$$;

create or replace function public.delete_client_note(p_note_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  delete from public.client_notes n
  where n.id = p_note_id
    and (n.author_id = auth.uid() or public.is_business_owner(n.business_id));
  if not found then
    raise exception 'NOTE_NOT_FOUND' using errcode = 'PT404';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Analytics
-- -----------------------------------------------------------------------------
create or replace function public.get_business_dashboard_stats(
  p_business_id uuid,
  p_date        date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz         text := public.app_timezone();
  v_date       date := coalesce(p_date, (now() at time zone public.app_timezone())::date);
  v_day_start  timestamptz;
  v_day_end    timestamptz;
  v_is_owner   boolean := public.is_business_owner(p_business_id) or public.is_admin();
  v_revenue    bigint;
  v_scheduled  bigint;
  v_collected  bigint;
  v_active     integer;
  v_completed  integer;
  v_pending    integer;
  v_booked     numeric;
  v_available  numeric;
  v_series     jsonb;
begin
  if not (public.is_business_member(p_business_id) or public.is_admin()) then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  v_day_start := v_date::timestamp at time zone v_tz;
  v_day_end   := (v_date + 1)::timestamp at time zone v_tz;

  select coalesce(sum(a.total_price_cents) filter (where a.status = 'completed'), 0),
         coalesce(sum(a.total_price_cents) filter (where a.status in ('confirmed', 'completed')), 0),
         count(*) filter (where a.status in ('requested', 'quoted', 'confirmed')),
         count(*) filter (where a.status = 'completed')
    into v_revenue, v_scheduled, v_active, v_completed
  from public.appointments a
  where a.business_id = p_business_id
    and a.starts_at >= v_day_start and a.starts_at < v_day_end;

  select count(*) into v_pending
  from public.appointments a
  where a.business_id = p_business_id and a.status = 'requested' and a.starts_at >= now();

  select coalesce(sum(t.amount_cents), 0) into v_collected
  from public.transactions t
  where t.business_id = p_business_id and t.status = 'success' and t.type <> 'refund'
    and t.paid_at >= v_day_start and t.paid_at < v_day_end;

  -- Utilisation = booked staff-minutes / available staff-minutes (working hours).
  select coalesce(sum(extract(epoch from (least(a.ends_at, v_day_end) - greatest(a.starts_at, v_day_start))) / 60.0), 0)
    into v_booked
  from public.appointments a
  where a.business_id = p_business_id
    and a.staff_id is not null
    and a.status in ('confirmed', 'completed')
    and a.starts_at < v_day_end and a.ends_at > v_day_start;

  select coalesce(sum(extract(epoch from ((iv ->> 'end')::time - (iv ->> 'start')::time)) / 60.0), 0)
    into v_available
  from public.staff_members sm
  cross join lateral jsonb_array_elements(coalesce(sm.working_hours -> public.weekday_key(v_date), '[]'::jsonb)) iv
  where sm.business_id = p_business_id and sm.is_active;

  select jsonb_agg(jsonb_build_object('date', d.day, 'revenue_cents', coalesce(r.rev, 0)) order by d.day)
    into v_series
  from (select v_date - g as day from generate_series(0, 6) g) d
  left join lateral (
    select sum(a.total_price_cents) as rev
    from public.appointments a
    where a.business_id = p_business_id
      and a.status = 'completed'
      and a.starts_at >= d.day::timestamp at time zone v_tz
      and a.starts_at <  (d.day + 1)::timestamp at time zone v_tz
  ) r on true;

  return jsonb_build_object(
    'date',                    v_date,
    'revenue_today_cents',     case when v_is_owner then v_revenue end,
    'scheduled_revenue_cents', case when v_is_owner then v_scheduled end,
    'collected_today_cents',   case when v_is_owner then v_collected end,
    'active_bookings',         v_active,
    'completed_today',         v_completed,
    'pending_requests',        v_pending,
    'booked_minutes',          round(v_booked),
    'available_minutes',       round(v_available),
    'utilization_rate',        case when v_available > 0 then round(least(v_booked / v_available, 1), 4) else 0 end,
    'revenue_series',          case when v_is_owner then coalesce(v_series, '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

create or replace function public.get_staff_earnings(
  p_business_id uuid,
  p_from        date,
  p_to          date
)
returns table (
  staff_id                uuid,
  display_name            text,
  commission_bps          integer,
  completed_appointments  integer,
  service_revenue_cents   bigint,
  commission_cents        bigint,
  tips_cents              bigint,
  total_earnings_cents    bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tz       text := public.app_timezone();
  v_from     timestamptz;
  v_to       timestamptz;
  v_is_owner boolean := public.is_business_owner(p_business_id) or public.is_admin();
  v_self     uuid := public.current_staff_id(p_business_id);
begin
  if not v_is_owner and v_self is null then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'INVALID_DATE_RANGE' using errcode = 'PT400';
  end if;
  v_from := p_from::timestamp at time zone v_tz;
  v_to   := (p_to + 1)::timestamp at time zone v_tz;

  return query
  select
    s.id,
    s.display_name,
    s.commission_bps,
    coalesce(a.cnt, 0)::integer,
    coalesce(a.revenue, 0)::bigint,
    coalesce(a.commission, 0)::bigint,
    coalesce(t.tips, 0)::bigint,
    (coalesce(a.commission, 0) + coalesce(t.tips, 0))::bigint
  from public.staff_members s
  left join lateral (
    select count(*) as cnt,
           sum(ap.total_price_cents) as revenue,
           sum(round(ap.total_price_cents * coalesce(ap.commission_bps, s.commission_bps) / 10000.0)) as commission
    from public.appointments ap
    where ap.staff_id = s.id and ap.status = 'completed'
      and ap.starts_at >= v_from and ap.starts_at < v_to
  ) a on true
  left join lateral (
    select sum(tp.amount_cents) as tips
    from public.staff_tips tp
    where tp.staff_id = s.id and tp.created_at >= v_from and tp.created_at < v_to
  ) t on true
  where s.business_id = p_business_id
    and (v_is_owner or s.id = v_self)
  order by s.display_name;
end;
$$;

-- -----------------------------------------------------------------------------
-- Housekeeping (pg_cron, every 5 minutes)
-- -----------------------------------------------------------------------------
create or replace function public.expire_stale_holds()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_holds    integer;
  v_quotes   integer;
  v_requeued integer;
  v_lapsed   integer;
begin
  -- 1. Unpaid deposit holds release their slot.
  update public.appointments
     set status = 'cancelled',
         cancellation_reason = 'Deposit not received in time'
   where status in ('requested', 'quoted')
     and deposit_status = 'pending'
     and hold_expires_at < now();
  get diagnostics v_holds = row_count;

  -- 2. Quotes past validity expire...
  update public.appointment_quotes
     set status = 'expired'
   where status = 'pending' and valid_until < now();
  get diagnostics v_quotes = row_count;

  -- 3. ...and their appointments return to 'requested' for a fresh quote.
  update public.appointments a
     set status = 'requested'
   where a.status = 'quoted'
     and a.deposit_status <> 'pending'
     and not exists (
       select 1 from public.appointment_quotes q
       where q.appointment_id = a.id and q.status in ('pending', 'accepted')
     );
  get diagnostics v_requeued = row_count;

  -- 4. Requests nobody actioned before the start time lapse.
  update public.appointments
     set status = 'cancelled',
         cancellation_reason = 'Request lapsed'
   where status in ('requested', 'quoted')
     and starts_at < now();
  get diagnostics v_lapsed = row_count;

  return jsonb_build_object('holds_released', v_holds, 'quotes_expired', v_quotes,
                            'requeued', v_requeued, 'lapsed', v_lapsed);
end;
$$;
