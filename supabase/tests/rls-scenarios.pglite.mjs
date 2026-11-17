import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Fast, Docker-free verification of every migration + RLS/booking/payment/POPIA
 * behaviour using PGlite (Postgres 17 in WASM). Supabase-provided schemas
 * (auth, vault, storage) and PostGIS are stubbed below; the stubs mirror the
 * real function signatures. The authoritative suite is still `supabase test db`.
 *
 *   npm run db:test:fast
 */
const MIG = process.argv[2] ?? fileURLToPath(new URL('../migrations', import.meta.url));
const db = new PGlite({ extensions: { pgcrypto, btree_gist, pg_trgm } });

const stubs = `
create schema extensions;
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public, extensions to anon, authenticated, service_role;
-- PostGIS stub (haversine on point(lng,lat))
create domain extensions.geometry as point;
create domain extensions.geography as point;
create function extensions.st_makepoint(x float8, y float8) returns extensions.geometry language sql immutable as $$ select point(x,y)::extensions.geometry $$;
create function extensions.st_setsrid(g extensions.geometry, s int) returns extensions.geometry language sql immutable as $$ select g $$;
create function extensions.st_x(g extensions.geometry) returns float8 language sql immutable as $$ select (g::point)[0] $$;
create function extensions.st_y(g extensions.geometry) returns float8 language sql immutable as $$ select (g::point)[1] $$;
create function extensions.st_distance(a extensions.geography, b extensions.geography) returns float8 language sql immutable as $$
  select 2*6371000*asin(sqrt(power(sin(radians(((b::point)[1]-(a::point)[1])/2)),2) + cos(radians((a::point)[1]))*cos(radians((b::point)[1]))*power(sin(radians(((b::point)[0]-(a::point)[0])/2)),2))) $$;
create function extensions.st_dwithin(a extensions.geography, b extensions.geography, d float8) returns boolean language sql immutable as $$ select extensions.st_distance(a,b) <= d $$;
grant execute on all functions in schema extensions to anon, authenticated, service_role;
-- auth stub
create schema auth; grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, phone text, raw_user_meta_data jsonb);
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb, '{}'::jsonb) $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;
-- vault stub
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
create view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(s text, n text, d text) returns uuid language sql as $$ insert into vault.secrets(secret,name,description) values (s,n,d) returning id $$;
-- storage stub
create schema storage; grant usage on schema storage to authenticated;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
-- supabase default privileges
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;
await db.exec(stubs);

for (const f of fs.readdirSync(MIG).filter(f => f.endsWith('.sql')).sort()) {
  let sql = fs.readFileSync(path.join(MIG, f), 'utf8');
  sql = sql.replace(/create extension if not exists postgis\s+with schema extensions;/, '')
           .replace(/extensions\.geography\(Point, 4326\)/g, 'extensions.geography')
           .replace(/using gist \(location\)/, 'using btree (id)');
  try { await db.exec(sql); console.log('OK  ', f); }
  catch (e) { console.log('FAIL', f, '\n   ', e.message, e.position ? `@${e.position}: ` + sql.slice(Math.max(0, e.position - 200), +e.position + 80) : ''); process.exit(1); }
}

// ---------------------------------------------------------------- scenario
const ids = { owner: 'aaaaaaaa-0000-0000-0000-000000000001', client: 'aaaaaaaa-0000-0000-0000-000000000002', client2: 'aaaaaaaa-0000-0000-0000-000000000003', staff: 'aaaaaaaa-0000-0000-0000-000000000004', admin: 'aaaaaaaa-0000-0000-0000-000000000005' };
await db.exec(`
insert into auth.users values
 ('${ids.owner}','owner@x.co.za',now(),null,'{"account_type":"business_owner","full_name":"Thandi Owner","popia_consent":"true","popia_consent_version":"2026-11"}'),
 ('${ids.client}','client@x.co.za',now(),null,'{"full_name":"Sipho Client","phone":"+27821234567"}'),
 ('${ids.client2}','c2@x.co.za',now(),null,'{"full_name":"<script>x</script>","account_type":"admin"}'),
 ('${ids.staff}','staff@x.co.za',now(),null,'{"full_name":"Lerato Staff"}'),
 ('${ids.admin}','admin@x.co.za',now(),null,'{}');
update public.profiles set role='admin' where id='${ids.admin}';
`);

let pass = 0, fail = 0;
const as = async (who, fn) => {
  const role = who === 'service' ? 'service_role' : who === 'anon' ? 'anon' : 'authenticated';
  const claims = who === 'service' ? { role: 'service_role' } : who === 'anon' ? { role: 'anon' } : { sub: ids[who], role: 'authenticated' };
  await db.exec(`set role ${role}; select set_config('request.jwt.claims', '${JSON.stringify(claims)}', false);`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claims','',false);`); }
};
const expectOk = async (name, who, sql, check) => {
  try { const r = await as(who, () => db.query(sql)); if (check && !check(r.rows)) throw new Error('check failed: ' + JSON.stringify(r.rows).slice(0, 300)); pass++; console.log('  ✓', name); return r.rows; }
  catch (e) { fail++; console.log('  ✗', name, '->', e.message); return []; }
};
const expectErr = async (name, who, sql, re) => {
  try { await as(who, () => db.query(sql)); fail++; console.log('  ✗', name, '-> expected error, got success'); }
  catch (e) { if (re.test(e.message)) { pass++; console.log('  ✓', name, `(${e.message.slice(0, 60)})`); } else { fail++; console.log('  ✗', name, '-> wrong error:', e.message); } }
};

console.log('\nScenario');
await expectOk('signup trigger whitelists role & strips html name', 'admin', `select role, full_name from profiles where id='${ids.client2}'`, r => r[0].role === 'client' && r[0].full_name === null);
await expectOk('owner role from metadata', 'owner', `select role from profiles where id='${ids.owner}'`, r => r[0].role === 'business_owner');
await expectErr('client cannot escalate role', 'client', `update profiles set role='admin' where id='${ids.client}'`, /permission denied/);
await expectErr('client cannot create business', 'client', `insert into businesses (name,slug,category_id,service_model,suburb,city,province,postal_code,location,travel_radius_km) values ('X Co','x-co',1,'mobile_onsite','Soweto','Johannesburg','gauteng','1804',point(27.9,-26.25),20)`, /row-level security/);
const [biz] = await expectOk('owner creates mobile business', 'owner', `insert into businesses (name,slug,category_id,service_model,suburb,city,province,postal_code,location,travel_radius_km) values ('Bra Mike Mobile Mechanics','bra-mike',7,'mobile_onsite','Soweto','Johannesburg','gauteng','1804',point(27.9,-26.25),20) returning id`);
await expectErr('owner cannot self-verify', 'owner', `update businesses set is_verified=true where id='${biz.id}'`, /permission denied/);
await expectErr('owner cannot set subaccount', 'owner', `update businesses set paystack_subaccount_code='ACCT_abcdef1' where id='${biz.id}'`, /permission denied/);
const [ownerStaff] = await expectOk('owner auto-added as staff lane', 'owner', `select id from staff_members where business_id='${biz.id}' and profile_id='${ids.owner}'`, r => r.length === 1);
const hours = JSON.stringify(Object.fromEntries(['mon','tue','wed','thu','fri','sat','sun'].map(d => [d, [{ start: '00:00', end: '23:59' }]])));
await expectOk('owner sets working hours', 'owner', `update staff_members set working_hours='${hours}' where id='${ownerStaff.id}' returning id`, r => r.length === 1);
await expectErr('invalid working hours rejected', 'owner', `update staff_members set working_hours='{"mon":[{"start":"17:00","end":"09:00"}]}' where id='${ownerStaff.id}'`, /check constraint/);
const [svc] = await expectOk('owner creates instant service w/ 20% deposit', 'owner', `insert into services (business_id,title,pricing_model,price_cents,duration_minutes,buffer_minutes,deposit_percent) values ('${biz.id}','Battery replacement','instant_book',85000,60,15,20) returning id`);
const [qsvc] = await expectOk('owner creates quote service', 'owner', `insert into services (business_id,title,pricing_model,duration_minutes) values ('${biz.id}','Engine diagnostics','quote_required',120) returning id`);
await expectErr('XSS in service title rejected', 'owner', `insert into services (business_id,title,pricing_model,price_cents,duration_minutes) values ('${biz.id}','<img src=x onerror=alert(1)>','instant_book',100,30)`, /check constraint/);
await expectOk('anon search finds business near client (no base address leak)', 'anon', `select * from search_businesses(-26.26, 27.91, 25)`, r => r.length === 1 && r[0].address_line1 === null && r[0].services_your_area === true && r[0].has_instant_book);
await expectOk('anon search far away excludes mobile biz', 'anon', `select * from search_businesses(-33.92, 18.42, 25)`, r => r.length === 0);
await expectErr('anon cannot read businesses table', 'anon', `select * from businesses`, /permission denied/);
await expectOk('client cannot see raw businesses table rows', 'client', `select * from businesses`, r => r.length === 0);
const slots = await expectOk('anon gets available slots tomorrow', 'anon', `select * from get_available_slots('${svc.id}', (now() at time zone 'Africa/Johannesburg')::date + 1)`, r => r.length > 10);
const slot = slots[8].slot_start.toISOString();
const addr = JSON.stringify({ line1: '12 Vilakazi St', suburb: 'Orlando West', city: 'Soweto', postal_code: '1804', lat: -26.24, lng: 27.91 });
const farAddr = JSON.stringify({ line1: '1 Long St', suburb: 'City Bowl', city: 'Cape Town', postal_code: '8001', lat: -33.92, lng: 18.42 });
await expectErr('booking outside travel radius rejected', 'client', `select * from book_appointment('${svc.id}','${slot}', null, '${farAddr}')`, /OUTSIDE_TRAVEL_RADIUS/);
await expectErr('mobile booking without address rejected', 'client', `select * from book_appointment('${svc.id}','${slot}')`, /ADDRESS_REQUIRED/);
const [appt] = await expectOk('client books (deposit pending, server price)', 'client', `select * from book_appointment('${svc.id}','${slot}', null, '${addr}', 'Car is in the driveway', '11111111-1111-1111-1111-111111111111')`, r => r[0].status === 'requested' && r[0].deposit_status === 'pending' && r[0].deposit_cents === 17000 && r[0].total_price_cents === 85000);
await expectOk('idempotent retry returns same booking', 'client', `select id from book_appointment('${svc.id}','${slot}', null, '${addr}', null, '11111111-1111-1111-1111-111111111111')`, r => r[0].id === appt.id);
await expectErr('double booking blocked (exclusion constraint)', 'client2', `select * from book_appointment('${svc.id}','${slot}', '${ownerStaff.id}', '${addr}')`, /SLOT_UNAVAILABLE|OUTSIDE_WORKING_HOURS/);
await expectOk('slot no longer offered', 'anon', `select * from get_available_slots('${svc.id}', (now() at time zone 'Africa/Johannesburg')::date + 1)`, r => !r.some(s => s.slot_start.toISOString() === slot));
await expectOk('client2 cannot see client1 booking', 'client2', `select * from appointments`, r => r.length === 0);
await expectErr('client cannot insert appointment directly', 'client', `insert into appointments (business_id,service_id,starts_at,ends_at) values ('${biz.id}','${svc.id}',now(),now()+interval '1h')`, /permission denied/);
await expectErr('client cannot confirm own booking', 'client', `select * from update_appointment_status('${appt.id}','confirmed')`, /CLIENTS_MAY_ONLY_CANCEL/);
await expectOk('owner can see client name (has booking)', 'owner', `select full_name from profiles where id='${ids.client}'`, r => r[0]?.full_name === 'Sipho Client');
await expectOk('owner cannot see unrelated client2', 'owner', `select * from profiles where id='${ids.client2}'`, r => r.length === 0);

console.log('\nPayments');
await expectErr('authenticated cannot call prepare_payment', 'client', `select prepare_payment('${ids.client}','${appt.id}','deposit')`, /permission denied/);
await expectErr('payouts not configured', 'service', `select prepare_payment('${ids.client}','${appt.id}','deposit')`, /BUSINESS_PAYOUTS_NOT_CONFIGURED/);
await expectOk('service sets payout account', 'service', `select set_business_payout_account('${biz.id}','ACCT_test1234','FNB','1234')`);
const [prep] = await expectOk('prepare deposit', 'service', `select prepare_payment('${ids.client}','${appt.id}','deposit') as p`, r => r[0].p.amount_cents === 17000 && r[0].p.platform_fee_cents === 1700);
const ref = prep?.p.reference;
await expectOk('amount mismatch flagged', 'service', `select apply_payment_success('paystack','${ref}','999',100,'ZAR',now(),'card',10,'${'a'.repeat(64)}') as r`, r => r[0].r.outcome === 'amount_mismatch');
const [prep2] = await expectOk('re-prepare deposit', 'service', `select prepare_payment('${ids.client}','${appt.id}','deposit') as p`);
const ref2 = prep2?.p.reference;
const auth = JSON.stringify({ authorization_code: 'AUTH_abc123xyz', reusable: true, signature: 'SIG_1', card_type: 'visa', last4: '4081', exp_month: '12', exp_year: '2030', bank: 'TEST BANK' });
await expectOk('apply success confirms + saves card', 'service', `select apply_payment_success('paystack','${ref2}','1001',17000,'ZAR',now(),'card',255,'${'b'.repeat(64)}','${auth}',true) as r`, r => r[0].r.outcome === 'applied');
await expectOk('duplicate webhook is no-op', 'service', `select apply_payment_success('paystack','${ref2}','1001',17000,'ZAR',now(),'card',255,'${'b'.repeat(64)}') as r`, r => r[0].r.outcome === 'duplicate');
await expectOk('appointment confirmed after deposit', 'client', `select status, deposit_status from appointments where id='${appt.id}'`, r => r[0].status === 'confirmed' && r[0].deposit_status === 'paid');
await expectOk('client sees saved card display fields', 'client', `select brand,last4 from payment_methods`, r => r[0].last4 === '4081');
await expectErr('client cannot read card token', 'client', `select authorization_ciphertext from payment_methods`, /permission denied/);
await expectOk('service decrypts token', 'service', `select get_payment_authorization('${ids.client}', (select id from payment_methods limit 1)) as c`, r => r[0].c === 'AUTH_abc123xyz');
await expectOk('timeline events written', 'client', `select event_type from appointment_events where appointment_id='${appt.id}' order by id`, r => r.map(x => x.event_type).join() === 'created,status_changed,payment_received');

console.log('\nStaff, notes, progress');
const [inv] = await expectOk('owner invites staff', 'owner', `insert into staff_members (business_id, display_name, invite_email, commission_bps) values ('${biz.id}','Lerato','STAFF@x.co.za',4000) returning id`);
await expectErr('staff not member before accept', 'staff', `select get_business_dashboard_stats('${biz.id}')`, /FORBIDDEN/);
await expectErr('wrong user cannot claim invite', 'client2', `select accept_staff_invite('${inv.id}')`, /INVITE_NOT_FOUND/);
await expectOk('staff accepts invite', 'staff', `select (accept_staff_invite('${inv.id}')).id`);
await expectOk('staff role set', 'staff', `select role from profiles where id='${ids.staff}'`, r => r[0].role === 'staff');
await expectErr('staff cannot raise own commission', 'staff', `update staff_members set commission_bps=10000 where id='${inv.id}'`, /STAFF_MAY_ONLY_EDIT_WORKING_HOURS/);
await expectOk('staff can edit own hours', 'staff', `update staff_members set working_hours='{"mon":[{"start":"09:00","end":"17:00"}]}' where id='${inv.id}' returning id`, r => r.length === 1);
await expectErr('staff without permission cannot read notes', 'staff', `select * from get_client_notes('${biz.id}','${ids.client}')`, /FORBIDDEN/);
await expectOk('owner adds encrypted note', 'owner', `select add_client_note('${biz.id}','${ids.client}','Prefers SMS. Gate code 4471.') as id`);
await expectErr('note about non-client rejected', 'owner', `select add_client_note('${biz.id}','${ids.client2}','x')`, /NOT_A_CLIENT/);
await expectOk('owner reads decrypted note', 'owner', `select body from get_client_notes('${biz.id}','${ids.client}')`, r => r[0].body.includes('4471'));
await expectErr('ciphertext not selectable', 'owner', `select body_ciphertext from client_notes`, /permission denied/);
await expectOk('staff sees dashboard but not revenue', 'staff', `select get_business_dashboard_stats('${biz.id}', (now() at time zone 'Africa/Johannesburg')::date + 1) as s`, r => r[0].s.revenue_today_cents === null && r[0].s.active_bookings === 1);
await expectOk('owner dashboard stats', 'owner', `select get_business_dashboard_stats('${biz.id}', (now() at time zone 'Africa/Johannesburg')::date + 1) as s`, r => r[0].s.scheduled_revenue_cents === 85000 && r[0].s.utilization_rate > 0);
await expectOk('owner progress en_route', 'owner', `select progress from update_job_progress('${appt.id}','en_route')`, r => r[0].progress === 'en_route');
await expectErr('progress cannot go backwards', 'owner', `select * from update_job_progress('${appt.id}','not_started')`, /MOVE_FORWARD/);
await expectErr('cannot complete future appointment', 'owner', `select * from update_appointment_status('${appt.id}','completed')`, /FUTURE/);
await expectOk('owner records cash tip', 'owner', `insert into staff_tips (business_id, staff_id, amount_cents, method, recorded_by) values ('${biz.id}','${inv.id}',5000,'cash','${ids.owner}') returning id`);
await expectErr('owner cannot fake in-app tip', 'owner', `insert into staff_tips (business_id, staff_id, amount_cents, method, recorded_by) values ('${biz.id}','${inv.id}',5000,'in_app','${ids.owner}')`, /row-level security/);
await expectOk('staff earnings (staff sees self only)', 'staff', `select * from get_staff_earnings('${biz.id}', current_date - 1, current_date + 1)`, r => r.length === 1 && Number(r[0].tips_cents) === 5000);

console.log('\nQuotes');
const s2 = (await as('anon', () => db.query(`select * from get_available_slots('${qsvc.id}', (now() at time zone 'Africa/Johannesburg')::date + 2)`))).rows[4].slot_start.toISOString();
const [qa] = await expectOk('client requests quote', 'client2', `select * from book_appointment('${qsvc.id}','${s2}', null, '${addr}', 'Engine light on')`, r => r[0].status === 'requested' && r[0].total_price_cents === null);
const [q] = await expectOk('owner sends quote', 'owner', `select * from submit_quote('${qa.id}', 120000, 'Includes diagnostics', 48, null, '${ownerStaff.id}')`, r => r[0].status === 'pending');
await expectErr('other client cannot accept', 'client', `select * from respond_to_quote('${q.id}', true)`, /QUOTE_NOT_FOUND/);
await expectOk('client accepts quote -> confirmed', 'client2', `select status,total_price_cents from respond_to_quote('${q.id}', true)`, r => r[0].status === 'confirmed' && r[0].total_price_cents === 120000);

console.log('\nPOPIA & audit');
await expectErr('active bookings block self-erasure', 'client2', `select anonymize_client('${ids.client2}','User request')`, /ACTIVE_BOOKINGS_EXIST/);
await expectOk('client exports own data', 'client', `select export_client_data() as d`, r => r[0].d.appointments.length === 1 && r[0].d.provider_notes === null);
await expectOk('admin forced erasure', 'admin', `select anonymize_client('${ids.client}','DSAR #42', true) as r`, r => r[0].r.notes_deleted === 1 && r[0].r.payment_methods_deleted === 1);
await expectOk('address scrubbed', 'admin', `select client_address_line1, status from appointments where id='${appt.id}'`, r => r[0].client_address_line1 === null && r[0].status === 'cancelled');
await expectOk('deposit flagged for refund', 'admin', `select requires_refund from transactions where reference='${ref2}'`, r => r[0].requires_refund === true);
await expectErr('audit log immutable', 'service', `delete from audit_logs`, /AUDIT_LOG_IMMUTABLE/);
await expectOk('audit log readable by owner (own business)', 'owner', `select count(*)::int c from audit_logs`, r => r[0].c > 0);
await expectOk('audit chain verifies clean', 'admin', `select * from verify_audit_chain()`, r => r.length === 0);
await expectOk('housekeeping runs', 'service', `select expire_stale_holds() as r, purge_expired_personal_data() as p`);
await db.exec(`alter table audit_logs disable trigger audit_logs_no_update_delete; update audit_logs set metadata='{"tampered":true}' where chain_seq=3; alter table audit_logs enable trigger audit_logs_no_update_delete;`);
await expectOk('tampering detected', 'admin', `select * from verify_audit_chain()`, r => r.some(x => x.chain_seq == 3));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
