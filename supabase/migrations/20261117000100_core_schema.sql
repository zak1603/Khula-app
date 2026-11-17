-- =============================================================================
-- Khula — 0100 Core schema
-- Extensions, enums, validation helpers, tables, constraints, indexes.
--
-- Conventions
--   * Money is stored as integer cents (ZAR). Never floats.
--   * Every table has RLS enabled (see 0200). Writes to booking/payment tables
--     happen ONLY through SECURITY DEFINER RPCs that validate everything.
--   * SECURITY DEFINER functions use `set search_path = ''` and fully qualify
--     every object to defeat search_path hijacking.
--   * Tenant integrity is enforced with composite foreign keys
--     (child.business_id must equal parent.business_id).
-- =============================================================================

create extension if not exists pgcrypto   with schema extensions;
create extension if not exists postgis    with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_trgm    with schema extensions;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.user_role          as enum ('admin', 'business_owner', 'staff', 'client');
create type public.service_model      as enum ('fixed_location', 'mobile_onsite');
create type public.pricing_model      as enum ('instant_book', 'quote_required');
create type public.appointment_status as enum ('requested', 'quoted', 'confirmed', 'completed', 'cancelled');
-- Ordered: progress may only move forward (enum comparison relies on this order).
create type public.job_progress       as enum ('not_started', 'en_route', 'arrived', 'in_progress', 'finished');
create type public.deposit_status     as enum ('not_required', 'pending', 'paid', 'refunded', 'forfeited');
create type public.quote_status       as enum ('pending', 'accepted', 'declined', 'expired', 'superseded');
create type public.booking_source     as enum ('app', 'web', 'walk_in');
create type public.payment_provider   as enum ('paystack', 'payfast');
create type public.transaction_type   as enum ('deposit', 'balance', 'tip', 'refund');
create type public.transaction_status as enum ('pending', 'success', 'failed', 'reversed', 'refunded');
create type public.tip_method         as enum ('cash', 'card', 'eft', 'in_app');
create type public.sa_province        as enum (
  'eastern_cape', 'free_state', 'gauteng', 'kwazulu_natal', 'limpopo',
  'mpumalanga', 'north_west', 'northern_cape', 'western_cape'
);

-- -----------------------------------------------------------------------------
-- Pure helper functions (immutable; used in CHECK constraints)
-- -----------------------------------------------------------------------------

-- South Africa has a single time zone; centralised so it is never hard-coded twice.
create or replace function public.app_timezone()
returns text
language sql
immutable
set search_path = ''
as $$ select 'Africa/Johannesburg'::text $$;

-- Defense-in-depth against stored XSS / control-character injection.
-- React escapes output, Zod validates input; this is the last line in the DB.
create or replace function public.is_plain_text(p text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is null or (
        p !~ '</?[A-Za-z!?]'                          -- no HTML/XML tags, comments or PIs
    and p !~* '(javascript|vbscript|data)\s*:'        -- no script URLs
    and p !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'       -- no control chars (\t \n \r allowed)
  );
$$;

-- working_hours shape: {"mon":[{"start":"09:00","end":"13:00"},{"start":"14:00","end":"17:00"}], ...}
create or replace function public.is_valid_working_hours(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_day      text;
  v_interval jsonb;
  v_start    time;
  v_end      time;
  v_prev_end time;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return false;
  end if;

  for v_day in select jsonb_object_keys(p) loop
    if v_day not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun') then
      return false;
    end if;
    if jsonb_typeof(p -> v_day) <> 'array' or jsonb_array_length(p -> v_day) > 4 then
      return false;
    end if;

    v_prev_end := null;
    for v_interval in select value from jsonb_array_elements(p -> v_day) loop
      if jsonb_typeof(v_interval) <> 'object'
         or coalesce(v_interval ->> 'start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         or coalesce(v_interval ->> 'end', '')   !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
        return false;
      end if;
      v_start := (v_interval ->> 'start')::time;
      v_end   := (v_interval ->> 'end')::time;
      if v_end <= v_start then
        return false;
      end if;
      -- intervals must be sorted and non-overlapping
      if v_prev_end is not null and v_start < v_prev_end then
        return false;
      end if;
      v_prev_end := v_end;
    end loop;
  end loop;

  return true;
end;
$$;

-- Generic updated_at maintenance.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- categories (lookup table — new industries need no migration)
-- -----------------------------------------------------------------------------
create table public.categories (
  id          smallint generated always as identity primary key,
  slug        text not null unique check (slug ~ '^[a-z][a-z0-9_]{1,40}$'),
  name        text not null check (char_length(name) between 2 and 60 and public.is_plain_text(name)),
  icon        text not null default 'briefcase' check (icon ~ '^[a-z0-9-]{1,40}$'), -- lucide icon name
  sort_order  smallint not null default 0,
  created_at  timestamptz not null default now()
);

insert into public.categories (slug, name, icon, sort_order) values
  ('hair_beauty',     'Hair & Beauty',     'scissors',      10),
  ('barber',          'Barber',            'scissors',      20),
  ('nails',           'Nails',             'sparkles',      30),
  ('plumbing',        'Plumbing',          'wrench',        40),
  ('electrical',      'Electrical',        'zap',           50),
  ('locksmith',       'Locksmith',         'key-round',     60),
  ('mobile_mechanic', 'Mobile Mechanic',   'car',           70),
  ('tutoring',        'Tutoring',          'graduation-cap',80),
  ('cleaning',        'Cleaning',          'spray-can',     90),
  ('garden',          'Garden & Outdoor',  'trees',        100),
  ('handyman',        'Handyman',          'hammer',       110),
  ('fitness',         'Fitness & Wellness','dumbbell',     120);

-- -----------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id                     uuid primary key references auth.users (id) on delete cascade,
  role                   public.user_role not null default 'client',
  full_name              text check (full_name is null or (char_length(full_name) between 1 and 120 and full_name !~ '[<>]')),
  phone                  text check (phone is null or phone ~ '^\+27[1-9][0-9]{8}$'),         -- E.164, SA only
  avatar_url             text check (avatar_url is null or (char_length(avatar_url) <= 1024 and avatar_url ~ '^https://')),
  preference_notes       text check (preference_notes is null or (char_length(preference_notes) <= 1000 and public.is_plain_text(preference_notes))),
  marketing_opt_in       boolean not null default false,
  popia_consent_at       timestamptz,
  popia_consent_version  text check (popia_consent_version is null or popia_consent_version ~ '^[A-Za-z0-9._-]{1,20}$'),
  anonymized_at          timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index profiles_role_idx on public.profiles (role);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- businesses
-- -----------------------------------------------------------------------------
create table public.businesses (
  id                        uuid primary key default gen_random_uuid(),
  owner_id                  uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  name                      text not null check (char_length(name) between 2 and 120 and name !~ '[<>]'),
  slug                      text not null unique check (char_length(slug) <= 80 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description               text check (description is null or (char_length(description) <= 2000 and public.is_plain_text(description))),
  category_id               smallint not null references public.categories (id),
  service_model             public.service_model not null,

  -- Operating address. For mobile_onsite businesses this is the operator's base
  -- (often a home address) and is NEVER exposed publicly — see search RPCs.
  address_line1             text check (address_line1 is null or (char_length(address_line1) between 2 and 200 and public.is_plain_text(address_line1))),
  address_line2             text check (address_line2 is null or (char_length(address_line2) <= 200 and public.is_plain_text(address_line2))),
  suburb                    text not null check (char_length(suburb) between 2 and 80 and public.is_plain_text(suburb)),
  city                      text not null check (char_length(city) between 2 and 80 and public.is_plain_text(city)),
  province                  public.sa_province not null,
  postal_code               text not null check (postal_code ~ '^[0-9]{4}$'),
  location                  extensions.geography(Point, 4326) not null,
  travel_radius_km          numeric(5, 1) check (travel_radius_km is null or (travel_radius_km > 0 and travel_radius_km <= 250)),

  phone                     text check (phone is null or phone ~ '^\+27[1-9][0-9]{8}$'),
  email                     text check (email is null or (char_length(email) <= 254 and email ~* '^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$')),
  logo_url                  text check (logo_url is null or (char_length(logo_url) <= 1024 and logo_url ~ '^https://')),

  -- Payments (writable only by service_role / admin RPCs — see column grants)
  paystack_subaccount_code  text unique check (paystack_subaccount_code is null or paystack_subaccount_code ~ '^ACCT_[A-Za-z0-9]{6,40}$'),
  payout_bank_name          text check (payout_bank_name is null or char_length(payout_bank_name) <= 80),
  payout_account_last4      text check (payout_account_last4 is null or payout_account_last4 ~ '^[0-9]{4}$'),
  platform_fee_bps          integer not null default 1000 check (platform_fee_bps between 0 and 5000), -- 1000 bps = 10%

  is_verified               boolean not null default false,
  is_active                 boolean not null default true,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint businesses_mobile_requires_radius
    check (service_model <> 'mobile_onsite' or travel_radius_km is not null),
  constraint businesses_fixed_requires_address
    check (service_model <> 'fixed_location' or address_line1 is not null)
);

create index businesses_owner_idx     on public.businesses (owner_id);
create index businesses_category_idx  on public.businesses (category_id) where is_active;
create index businesses_location_gix  on public.businesses using gist (location);
create index businesses_name_trgm_idx on public.businesses using gin (name extensions.gin_trgm_ops);

create trigger businesses_set_updated_at
  before update on public.businesses
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- staff_members
-- profile_id NULL  => "offline" staff (calendar lane only, no app login)
-- invite_email set => pending invite; linked only when that user accepts.
-- -----------------------------------------------------------------------------
create table public.staff_members (
  id                     uuid primary key default gen_random_uuid(),
  business_id            uuid not null references public.businesses (id) on delete cascade,
  profile_id             uuid references public.profiles (id) on delete set null,
  display_name           text not null check (char_length(display_name) between 1 and 80 and display_name !~ '[<>]'),
  role_title             text check (role_title is null or (char_length(role_title) <= 80 and role_title !~ '[<>]')),
  avatar_url             text check (avatar_url is null or (char_length(avatar_url) <= 1024 and avatar_url ~ '^https://')),
  invite_email           text check (invite_email is null or (char_length(invite_email) <= 254 and invite_email ~* '^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$')),
  invite_accepted_at     timestamptz,
  commission_bps         integer not null default 5000 check (commission_bps between 0 and 10000), -- staff share of service revenue
  working_hours          jsonb not null default '{}'::jsonb check (public.is_valid_working_hours(working_hours)),
  can_view_client_notes  boolean not null default false,
  can_manage_bookings    boolean not null default true,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint staff_members_business_profile_key unique (business_id, profile_id),
  constraint staff_members_id_business_key unique (id, business_id)   -- target for composite FKs
);

create index staff_members_profile_idx on public.staff_members (profile_id) where profile_id is not null;
create index staff_members_invite_idx  on public.staff_members (lower(invite_email)) where invite_email is not null and profile_id is null;

create trigger staff_members_set_updated_at
  before update on public.staff_members
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- services
-- -----------------------------------------------------------------------------
create table public.services (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses (id) on delete cascade,
  category_id       smallint references public.categories (id),
  title             text not null check (char_length(title) between 2 and 120 and title !~ '[<>]'),
  description       text check (description is null or (char_length(description) <= 2000 and public.is_plain_text(description))),
  pricing_model     public.pricing_model not null default 'instant_book',
  price_cents       integer check (price_cents is null or price_cents between 0 and 100000000), -- "from" price when quote_required
  duration_minutes  integer not null check (duration_minutes between 5 and 1440),
  buffer_minutes    integer not null default 0 check (buffer_minutes between 0 and 240),
  deposit_percent   smallint not null default 0 check (deposit_percent between 0 and 100),
  is_active         boolean not null default true,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint services_instant_book_requires_price
    check (pricing_model <> 'instant_book' or price_cents is not null),
  constraint services_id_business_key unique (id, business_id)
);

create index services_business_idx on public.services (business_id) where is_active;

create trigger services_set_updated_at
  before update on public.services
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- appointments
-- -----------------------------------------------------------------------------
create table public.appointments (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references public.businesses (id) on delete restrict,
  service_id            uuid not null,
  staff_id              uuid,
  client_id             uuid references public.profiles (id) on delete set null,
  walk_in_name          text check (walk_in_name is null or (char_length(walk_in_name) between 1 and 120 and walk_in_name !~ '[<>]')),
  walk_in_phone         text check (walk_in_phone is null or walk_in_phone ~ '^\+27[1-9][0-9]{8}$'),
  source                public.booking_source not null default 'app',

  status                public.appointment_status not null default 'requested',
  progress              public.job_progress not null default 'not_started',

  starts_at             timestamptz not null,
  ends_at               timestamptz not null,
  buffer_minutes        integer not null default 0 check (buffer_minutes between 0 and 240),
  blocked_until         timestamptz not null,       -- ends_at + buffer; maintained by trigger

  -- Mobile / on-site jobs (PII: purged 90 days after completion — POPIA retention)
  is_mobile             boolean not null default false,
  client_address_line1  text check (client_address_line1 is null or (char_length(client_address_line1) between 2 and 200 and public.is_plain_text(client_address_line1))),
  client_address_line2  text check (client_address_line2 is null or (char_length(client_address_line2) <= 200 and public.is_plain_text(client_address_line2))),
  client_suburb         text check (client_suburb is null or (char_length(client_suburb) between 2 and 80 and public.is_plain_text(client_suburb))),
  client_city           text check (client_city is null or (char_length(client_city) between 2 and 80 and public.is_plain_text(client_city))),
  client_postal_code    text check (client_postal_code is null or client_postal_code ~ '^[0-9]{4}$'),
  client_location       extensions.geography(Point, 4326),
  client_message        text check (client_message is null or (char_length(client_message) <= 1000 and public.is_plain_text(client_message))),

  total_price_cents     integer check (total_price_cents is null or total_price_cents >= 0),
  deposit_cents         integer not null default 0 check (deposit_cents >= 0),
  deposit_status        public.deposit_status not null default 'not_required',
  hold_expires_at       timestamptz,
  commission_bps        integer check (commission_bps is null or commission_bps between 0 and 10000), -- snapshot at completion

  idempotency_key       uuid,
  cancelled_at          timestamptz,
  cancelled_by          uuid references public.profiles (id) on delete set null,
  cancellation_reason   text check (cancellation_reason is null or (char_length(cancellation_reason) <= 500 and public.is_plain_text(cancellation_reason))),
  completed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint appointments_service_fk
    foreign key (service_id, business_id) references public.services (id, business_id) on delete restrict,
  constraint appointments_staff_fk
    foreign key (staff_id, business_id) references public.staff_members (id, business_id) on delete set null (staff_id),
  constraint appointments_time_order      check (ends_at > starts_at),
  constraint appointments_max_duration    check (ends_at - starts_at <= interval '24 hours'),
  constraint appointments_deposit_le_total check (total_price_cents is null or deposit_cents <= total_price_cents),
  constraint appointments_idempotency_key unique (client_id, idempotency_key),
  constraint appointments_id_business_key unique (id, business_id),

  -- THE double-booking guard: a staff member can never hold two overlapping
  -- active bookings (including buffer time). Enforced atomically by Postgres.
  constraint appointments_no_staff_overlap
    exclude using gist (
      staff_id with =,
      tstzrange(starts_at, blocked_until, '[)') with &&
    ) where (staff_id is not null and status in ('requested', 'quoted', 'confirmed'))
);

create index appointments_business_starts_idx on public.appointments (business_id, starts_at);
create index appointments_client_idx          on public.appointments (client_id, starts_at desc) where client_id is not null;
create index appointments_staff_starts_idx    on public.appointments (staff_id, starts_at) where staff_id is not null;
create index appointments_hold_idx            on public.appointments (hold_expires_at) where deposit_status = 'pending';
create index appointments_open_status_idx     on public.appointments (status, starts_at) where status in ('requested', 'quoted');

create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- appointment_quotes
-- -----------------------------------------------------------------------------
create table public.appointment_quotes (
  id                  uuid primary key default gen_random_uuid(),
  appointment_id      uuid not null,
  business_id         uuid not null,
  created_by          uuid references public.profiles (id) on delete set null,
  amount_cents        integer not null check (amount_cents between 100 and 100000000),
  message             text check (message is null or (char_length(message) <= 2000 and public.is_plain_text(message))),
  proposed_starts_at  timestamptz,
  proposed_staff_id   uuid,
  valid_until         timestamptz not null,
  status              public.quote_status not null default 'pending',
  responded_at        timestamptz,
  created_at          timestamptz not null default now(),

  constraint appointment_quotes_appointment_fk
    foreign key (appointment_id, business_id) references public.appointments (id, business_id) on delete cascade,
  constraint appointment_quotes_staff_fk
    foreign key (proposed_staff_id, business_id) references public.staff_members (id, business_id) on delete set null (proposed_staff_id),
  constraint appointment_quotes_validity check (valid_until > created_at)
);

create unique index appointment_quotes_one_pending_idx
  on public.appointment_quotes (appointment_id) where status = 'pending';
create index appointment_quotes_business_idx on public.appointment_quotes (business_id, created_at desc);

-- -----------------------------------------------------------------------------
-- appointment_events (status timeline; drives the realtime tracker)
-- -----------------------------------------------------------------------------
create table public.appointment_events (
  id              bigint generated always as identity primary key,
  appointment_id  uuid not null references public.appointments (id) on delete cascade,
  business_id     uuid not null references public.businesses (id) on delete cascade,
  actor_id        uuid references public.profiles (id) on delete set null,
  event_type      text not null check (event_type in ('created', 'status_changed', 'progress_changed', 'rescheduled', 'quote_sent', 'quote_responded', 'payment_received')),
  from_status     public.appointment_status,
  to_status       public.appointment_status,
  from_progress   public.job_progress,
  to_progress     public.job_progress,
  note            text check (note is null or char_length(note) <= 500),
  created_at      timestamptz not null default now()
);

create index appointment_events_appointment_idx on public.appointment_events (appointment_id, created_at);

-- -----------------------------------------------------------------------------
-- client_notes — encrypted at rest (pgp_sym_encrypt / AES-256, key in Supabase Vault)
-- -----------------------------------------------------------------------------
create table public.client_notes (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses (id) on delete cascade,
  client_id        uuid not null references public.profiles (id) on delete cascade,
  author_id        uuid references public.profiles (id) on delete set null,
  body_ciphertext  bytea not null,
  key_version      smallint not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index client_notes_business_client_idx on public.client_notes (business_id, client_id, created_at desc);

create trigger client_notes_set_updated_at
  before update on public.client_notes
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- transactions — payment ledger (written only by service_role via payment RPCs)
-- -----------------------------------------------------------------------------
create table public.transactions (
  id                       uuid primary key default gen_random_uuid(),
  business_id              uuid not null references public.businesses (id) on delete restrict,
  appointment_id           uuid references public.appointments (id) on delete set null,
  client_id                uuid references public.profiles (id) on delete set null,
  staff_id                 uuid references public.staff_members (id) on delete set null,
  provider                 public.payment_provider not null default 'paystack',
  type                     public.transaction_type not null,
  status                   public.transaction_status not null default 'pending',
  reference                text not null unique check (reference ~ '^KH-[A-Z0-9-]{8,64}$'),
  provider_transaction_id  text check (provider_transaction_id is null or char_length(provider_transaction_id) <= 64),
  amount_cents             bigint not null check (amount_cents > 0),
  currency                 char(3) not null default 'ZAR' check (currency = 'ZAR'),
  platform_fee_cents       bigint not null default 0 check (platform_fee_cents >= 0),
  vendor_amount_cents      bigint generated always as (amount_cents - platform_fee_cents) stored,
  provider_fee_cents       bigint check (provider_fee_cents is null or provider_fee_cents >= 0),
  subaccount_code          text,
  channel                  text check (channel is null or char_length(channel) <= 32),
  paid_at                  timestamptz,
  webhook_payload_sha256   text check (webhook_payload_sha256 is null or webhook_payload_sha256 ~ '^[a-f0-9]{64}$'),
  signature_verified_at    timestamptz,
  requires_refund          boolean not null default false,
  failure_reason           text check (failure_reason is null or char_length(failure_reason) <= 200),
  metadata                 jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint transactions_fee_le_amount check (platform_fee_cents <= amount_cents)
);

create unique index transactions_provider_txn_key
  on public.transactions (provider, provider_transaction_id) where provider_transaction_id is not null;
create index transactions_business_paid_idx on public.transactions (business_id, paid_at desc) where status = 'success';
create index transactions_appointment_idx   on public.transactions (appointment_id) where appointment_id is not null;
create index transactions_client_idx        on public.transactions (client_id) where client_id is not null;
create index transactions_refund_queue_idx  on public.transactions (created_at) where requires_refund;

create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- staff_tips — append-only tips ledger (corrections are negative entries)
-- -----------------------------------------------------------------------------
create table public.staff_tips (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses (id) on delete cascade,
  staff_id        uuid not null,
  appointment_id  uuid references public.appointments (id) on delete set null,
  transaction_id  uuid unique references public.transactions (id) on delete set null,
  amount_cents    integer not null check (amount_cents <> 0 and amount_cents between -10000000 and 10000000),
  method          public.tip_method not null,
  note            text check (note is null or (char_length(note) <= 280 and public.is_plain_text(note))),
  recorded_by     uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),

  constraint staff_tips_staff_fk
    foreign key (staff_id, business_id) references public.staff_members (id, business_id) on delete restrict -- ledger must survive; deactivate staff instead
);

create index staff_tips_business_created_idx on public.staff_tips (business_id, created_at desc);
create index staff_tips_staff_idx            on public.staff_tips (staff_id, created_at desc);

-- -----------------------------------------------------------------------------
-- payment_methods — tokenised cards (Paystack authorization_code, encrypted).
-- No PAN/CVV is ever seen or stored (keeps us out of PCI-DSS SAQ-D scope).
-- -----------------------------------------------------------------------------
create table public.payment_methods (
  id                        uuid primary key default gen_random_uuid(),
  client_id                 uuid not null references public.profiles (id) on delete cascade,
  provider                  public.payment_provider not null default 'paystack',
  authorization_ciphertext  bytea not null,
  card_signature            text not null check (char_length(card_signature) <= 128),  -- provider fingerprint (dedupe)
  brand                     text check (brand is null or char_length(brand) <= 32),
  last4                     text check (last4 is null or last4 ~ '^[0-9]{4}$'),
  exp_month                 smallint check (exp_month is null or exp_month between 1 and 12),
  exp_year                  smallint check (exp_year is null or exp_year between 2000 and 2100),
  bank                      text check (bank is null or char_length(bank) <= 80),
  is_default                boolean not null default false,
  created_at                timestamptz not null default now(),

  constraint payment_methods_card_key unique (client_id, provider, card_signature)
);

-- -----------------------------------------------------------------------------
-- webhook_events — idempotency + forensic trail. Stores a HASH of the payload,
-- never the raw payload (it contains customer PII).
-- -----------------------------------------------------------------------------
create table public.webhook_events (
  id              bigint generated always as identity primary key,
  provider        public.payment_provider not null,
  event_key       text not null check (char_length(event_key) <= 200),
  event_type      text not null check (char_length(event_type) <= 64),
  payload_sha256  text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  status          text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  attempts        integer not null default 1,
  last_error      text check (last_error is null or char_length(last_error) <= 500),
  received_at     timestamptz not null default now(),
  processed_at    timestamptz,

  constraint webhook_events_provider_event_key unique (provider, event_key)
);

-- -----------------------------------------------------------------------------
-- audit_logs — append-only, hash-chained (tamper-evident). POPIA s19/s22.
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id           bigint generated always as identity primary key,
  chain_seq    bigint not null unique,                 -- assigned under advisory lock
  occurred_at  timestamptz not null default clock_timestamp(),
  actor_id     uuid,                                   -- no FK: must survive user erasure
  actor_role   text,
  action       text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  entity_type  text not null check (char_length(entity_type) <= 64),
  entity_id    text check (entity_id is null or char_length(entity_id) <= 64),
  business_id  uuid,
  metadata     jsonb not null default '{}'::jsonb,
  prev_hash    text,
  row_hash     text not null
);

create index audit_logs_business_idx on public.audit_logs (business_id, occurred_at desc) where business_id is not null;
create index audit_logs_entity_idx   on public.audit_logs (entity_type, entity_id);
create index audit_logs_actor_idx    on public.audit_logs (actor_id, occurred_at desc) where actor_id is not null;
