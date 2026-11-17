-- Local development seed. NEVER run against production.
-- Creates demo users (password: KhulaDemo2026!) and two businesses.

do $$
declare
  v_owner  uuid := '00000000-0000-4000-8000-000000000001';
  v_client uuid := '00000000-0000-4000-8000-000000000002';
  v_salon  uuid;
  v_mech   uuid;
  v_hours  jsonb := '{"mon":[{"start":"08:00","end":"17:00"}],"tue":[{"start":"08:00","end":"17:00"}],"wed":[{"start":"08:00","end":"17:00"}],"thu":[{"start":"08:00","end":"17:00"}],"fri":[{"start":"08:00","end":"17:00"}],"sat":[{"start":"08:00","end":"13:00"}]}';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', v_owner, 'authenticated', 'authenticated', 'owner@khula.test',
     extensions.crypt('KhulaDemo2026!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}',
     '{"full_name":"Thandi Mokoena","account_type":"business_owner","popia_consent":"true","popia_consent_version":"2026-11"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_client, 'authenticated', 'authenticated', 'client@khula.test',
     extensions.crypt('KhulaDemo2026!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}',
     '{"full_name":"Sipho Dlamini","popia_consent":"true","popia_consent_version":"2026-11"}', now(), now());

  insert into public.businesses (owner_id, name, slug, description, category_id, service_model,
    address_line1, suburb, city, province, postal_code, location)
  values (v_owner, 'Thandi''s Hair Studio', 'thandis-hair-studio', 'Braids, locs and natural hair care.',
    (select id from public.categories where slug = 'hair_beauty'), 'fixed_location',
    '45 Main Road', 'Melville', 'Johannesburg', 'gauteng', '2092',
    extensions.st_setsrid(extensions.st_makepoint(28.0105, -26.1766), 4326)::extensions.geography)
  returning id into v_salon;

  insert into public.businesses (owner_id, name, slug, description, category_id, service_model,
    suburb, city, province, postal_code, location, travel_radius_km)
  values (v_owner, 'Mokoena Mobile Mechanics', 'mokoena-mobile-mechanics', 'We come to you — batteries, services, diagnostics.',
    (select id from public.categories where slug = 'mobile_mechanic'), 'mobile_onsite',
    'Soweto', 'Johannesburg', 'gauteng', '1804',
    extensions.st_setsrid(extensions.st_makepoint(27.8585, -26.2485), 4326)::extensions.geography, 30)
  returning id into v_mech;

  update public.staff_members set working_hours = v_hours where business_id in (v_salon, v_mech);

  insert into public.services (business_id, title, description, pricing_model, price_cents, duration_minutes, buffer_minutes, deposit_percent) values
    (v_salon, 'Knotless braids (medium)', 'Includes wash and blow-dry.', 'instant_book', 85000, 240, 15, 20),
    (v_salon, 'Silk press', null, 'instant_book', 45000, 90, 10, 0),
    (v_mech,  'Battery replacement', 'Battery supplied at cost.', 'instant_book', 35000, 60, 30, 0),
    (v_mech,  'Engine diagnostics', 'Price depends on vehicle — we will quote.', 'quote_required', null, 120, 30, 25);
end;
$$;
