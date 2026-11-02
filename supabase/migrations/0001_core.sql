-- Ọ̀nà phase 1: people, businesses, fleet, settings, audit, notifications.
-- Every table has row-level security. Reads are scoped by policy; every change
-- goes through a SECURITY DEFINER function (or the admin-users edge function,
-- which uses the service role and checks the caller's role first).

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- types
create type app_role as enum ('super_admin','operations','owner','rider','customer');
create type user_status as enum ('active','inactive');
create type vehicle_type as enum ('bike','car','van','truck');
create type vehicle_status as enum ('available','assigned','in_use','under_repair','retired');
create type rider_availability as enum ('available','off','on_trip','paused');

-- ---------------------------------------------------------------- businesses
create table businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 80),
  case_no int unique,                       -- study case number; no registration or tax fields (dissertation 3.12)
  sector text,
  phone text,
  pickup_address text,
  pickup_landmark text,
  pickup_lat numeric(9,6),
  pickup_lng numeric(9,6),
  zone text,
  hours text,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- people
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  phone text,
  role app_role not null default 'customer',
  status user_status not null default 'active',
  business_id uuid references businesses(id),   -- owners only
  ops_lead boolean not null default false,       -- operations: lead can create dispatch staff
  must_change_password boolean not null default false,
  last_login timestamptz,
  created_at timestamptz not null default now(),
  constraint owner_has_business check ((role = 'owner') = (business_id is not null))
);
create index profiles_role_idx on profiles (role);
create index profiles_business_idx on profiles (business_id);

-- ---------------------------------------------------------------- fleet
create table vehicles (
  id uuid primary key default gen_random_uuid(),
  type vehicle_type not null,
  plate text not null unique check (length(trim(plate)) between 3 and 15),
  capacity_bags int not null check (capacity_bags > 0),
  status vehicle_status not null default 'available',
  note text,
  created_at timestamptz not null default now()
);

create table riders (
  profile_id uuid primary key references profiles(id) on delete cascade,
  vehicle_id uuid unique references vehicles(id),  -- one rider per vehicle at a time
  zone text,
  licence_expiry date,
  availability rider_availability not null default 'available',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- settings (super admin edits)
create table settings (
  key text primary key,
  value jsonb not null,
  description text
);
insert into settings (key, value, description) values
  ('distance_bands', '["0–5 km","5–15 km","15–30 km","30 km+"]', 'Distance bands for delivery fees'),
  ('band_limits_km', '[5,15,30]', 'Upper limit of each band except the last'),
  ('fees', '{"bike":[1500,2500,4000,6000],"car":[3000,4500,7000,10000],"van":[6000,9000,13000,18000],"truck":[15000,22000,32000,45000]}', 'Delivery fee by vehicle and distance band, in naira'),
  ('waiting_free_minutes', '10', 'Free waiting at pickup'),
  ('waiting_rate', '200', 'Naira per started block after the free minutes'),
  ('waiting_block_minutes', '5', 'Length of a waiting block'),
  ('failed_pickup_after_minutes', '20', 'Rider may record a failed pickup after this wait (30 if the shop asked for more time)'),
  ('slots', '{"mon_sat":["08:00-10:00","10:00-12:00","12:00-14:00","14:00-16:00","16:00-18:00","18:00-20:00"],"sun":["12:00-14:00","14:00-16:00","16:00-18:00"]}', 'Delivery windows'),
  ('slot_capacity', '15', 'Orders per zone per slot'),
  ('payment_cutoff_minutes', '60', 'Delivery fee must be confirmed this long before the slot starts'),
  ('receipt_target_minutes', '15', 'Target time to confirm a receipt in operating hours'),
  ('receipt_escalate_minutes', '30', 'Receipts waiting this long are escalated'),
  ('payment_window_hours', '2', 'Time to pay after requesting dispatch; paused while a receipt is checked'),
  ('max_receipt_attempts', '3', 'Receipt uploads allowed before the dispatch request closes'),
  ('code_max_attempts', '5', 'Wrong pickup, handover or delivery codes before the code locks'),
  ('claim_limit', '100000', 'Most Ọ̀nà pays per order for rider-caused loss or damage'),
  ('claim_hours', '48', 'Hours after delivery to claim for damage'),
  ('missing_item_hours', '24', 'Hours after delivery to report a missing item'),
  ('location_retention_days', '30', 'Raw rider location points are deleted after this'),
  ('email_daily_cap', '100', 'Resend free plan daily limit'),
  ('bank_details', '{"bank":"[BANK NAME]","account_name":"[ỌNÀ LTD]","account_no":"[ACCOUNT NUMBER]"}', 'Shown when a business pays a delivery fee'),
  ('operating_hours', '{"mon_sat":"08:00-20:00","sun":"12:00-18:00"}', 'When receipts are confirmed and riders work');

-- ---------------------------------------------------------------- audit and notifications
create table audit_log (
  id bigserial primary key,
  entity text not null,
  entity_id text,
  action text not null,
  reason text,
  old_value jsonb,
  new_value jsonb,
  user_id uuid,
  at timestamptz not null default now()
);
create index audit_log_at_idx on audit_log (at desc);

create table notifications (
  id bigserial primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  event text not null,
  title text not null,
  body text,
  link text,
  send_email boolean not null default false,
  email_sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, created_at desc);

-- ---------------------------------------------------------------- helpers
create or replace function my_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and status = 'active'
$$;

create or replace function has_role(variadic roles app_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = any(roles) from profiles where id = auth.uid() and status = 'active'), false)
$$;

create or replace function my_business_id() returns uuid
language sql stable security definer set search_path = public as $$
  select business_id from profiles where id = auth.uid() and status = 'active' and role = 'owner'
$$;

create or replace function is_ops_lead() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select ops_lead from profiles where id = auth.uid() and status = 'active' and role = 'operations'), false)
$$;

create or replace function setting(k text) returns jsonb
language sql stable security definer set search_path = public as $$
  select value from settings where key = k
$$;

create or replace function setting_num(k text) returns numeric
language sql stable security definer set search_path = public as $$
  select (value #>> '{}')::numeric from settings where key = k
$$;

create or replace function audit(p_entity text, p_entity_id text, p_action text, p_reason text, p_old jsonb, p_new jsonb)
returns void language sql security definer set search_path = public as $$
  insert into audit_log (entity, entity_id, action, reason, old_value, new_value, user_id)
  values (p_entity, p_entity_id, p_action, p_reason, p_old, p_new, auth.uid())
$$;

create or replace function audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into audit_log (entity, entity_id, action, old_value, new_value, user_id)
  values (tg_table_name, coalesce(r->>'id', r->>'key', r->>'profile_id'), lower(tg_op),
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
          auth.uid());
  return coalesce(new, old);
end $$;

create trigger audit_businesses after insert or update or delete on businesses for each row execute function audit_trigger();
create trigger audit_vehicles after insert or update or delete on vehicles for each row execute function audit_trigger();
create trigger audit_riders after insert or update or delete on riders for each row execute function audit_trigger();
create trigger audit_settings after insert or update or delete on settings for each row execute function audit_trigger();
create trigger audit_profiles after update on profiles for each row
  when (old.role is distinct from new.role or old.status is distinct from new.status or old.business_id is distinct from new.business_id)
  execute function audit_trigger();

-- New auth user -> profile. Customers sign themselves up and always get 'customer'.
-- Staff, owners and riders are created by the admin-users edge function, which sets
-- app_metadata (only the service role can write it) with their role.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
        r app_role := coalesce(nullif(m->>'ona_role','')::app_role, 'customer');
begin
  insert into profiles (id, email, full_name, phone, role, business_id, ops_lead, must_change_password)
  values (new.id, lower(new.email),
          coalesce(new.raw_user_meta_data->>'full_name', ''),
          nullif(m->>'phone',''),
          r,
          case when r = 'owner' then nullif(m->>'business_id','')::uuid end,
          coalesce((m->>'ops_lead')::boolean, false),
          coalesce((m->>'must_change_password')::boolean, false))
  on conflict (id) do nothing;
  if r = 'rider' then
    insert into riders (profile_id, zone, licence_expiry)
    values (new.id, nullif(m->>'zone',''), nullif(m->>'licence_expiry','')::date)
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------- RLS
alter table businesses enable row level security;
alter table profiles enable row level security;
alter table vehicles enable row level security;
alter table riders enable row level security;
alter table settings enable row level security;
alter table audit_log enable row level security;
alter table notifications enable row level security;

-- profiles: you see yourself; super admin and Operations see staff, owners and riders, never customers
create policy profiles_self on profiles for select using (id = auth.uid());
create policy profiles_staff on profiles for select
  using (role <> 'customer' and has_role('super_admin','operations'));

-- businesses: super admin all; Operations all (pickup points for routing); an owner only their own
create policy businesses_staff on businesses for select using (has_role('super_admin','operations'));
create policy businesses_own on businesses for select using (id = my_business_id());

-- fleet: Operations and super admin; a rider sees their own record and vehicle
create policy vehicles_staff on vehicles for select using (has_role('super_admin','operations'));
create policy vehicles_own on vehicles for select
  using (exists (select 1 from riders r where r.vehicle_id = vehicles.id and r.profile_id = auth.uid()));
create policy riders_staff on riders for select using (has_role('super_admin','operations'));
create policy riders_own on riders for select using (profile_id = auth.uid());

-- settings: any signed-in user can read (fees and slots are shown to businesses); changes via set_setting
create policy settings_read on settings for select using (auth.uid() is not null);

-- audit: super admin and Operations leads
create policy audit_read on audit_log for select using (has_role('super_admin') or is_ops_lead());

-- notifications: your own
create policy notif_own on notifications for select using (user_id = auth.uid());
create policy notif_own_update on notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------- account functions
create or replace function my_account() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'profile', to_jsonb(p) || jsonb_build_object('business_name', b.name),
    'business', to_jsonb(b),
    'rider', case when p.role = 'rider' then (select to_jsonb(r) || jsonb_build_object('vehicle', to_jsonb(v))
                                              from riders r left join vehicles v on v.id = r.vehicle_id where r.profile_id = p.id) end,
    'email_confirmed', (select u.email_confirmed_at is not null from auth.users u where u.id = p.id)
  )
  from profiles p left join businesses b on b.id = p.business_id
  where p.id = auth.uid()
$$;

create or replace function touch_login() returns void
language sql security definer set search_path = public as $$
  update profiles set last_login = now() where id = auth.uid()
$$;

create or replace function password_changed() returns void
language sql security definer set search_path = public as $$
  update profiles set must_change_password = false where id = auth.uid()
$$;

create or replace function update_my_profile(p_full_name text, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if length(trim(coalesce(p_full_name,''))) < 2 then raise exception 'Enter your name.'; end if;
  update profiles set full_name = trim(p_full_name), phone = nullif(trim(coalesce(p_phone,'')),'') where id = auth.uid();
end $$;

-- ---------------------------------------------------------------- businesses (super admin)
create or replace function update_business(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- the super admin edits any business; an owner edits their own pickup details
  if not (has_role('super_admin') or p_id = my_business_id()) then raise exception 'You cannot change this business.'; end if;
  update businesses set
    name = coalesce(nullif(trim(p->>'name'),''), name),
    sector = coalesce(p->>'sector', sector),
    phone = coalesce(p->>'phone', phone),
    pickup_address = coalesce(p->>'pickup_address', pickup_address),
    pickup_landmark = coalesce(p->>'pickup_landmark', pickup_landmark),
    pickup_lat = coalesce((p->>'pickup_lat')::numeric, pickup_lat),
    pickup_lng = coalesce((p->>'pickup_lng')::numeric, pickup_lng),
    zone = coalesce(p->>'zone', zone),
    hours = coalesce(p->>'hours', hours)
  where id = p_id;
end $$;

create or replace function set_business_active(p_id uuid, p_active boolean, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('super_admin') then raise exception 'Only the super admin can do this.'; end if;
  if length(trim(coalesce(p_reason,''))) < 5 then raise exception 'Give a reason.'; end if;
  update businesses set active = p_active where id = p_id;
  perform audit('business', p_id::text, case when p_active then 'reactivated' else 'deactivated' end, p_reason, null, null);
end $$;

-- ---------------------------------------------------------------- fleet (Operations)
create or replace function create_vehicle(p_type vehicle_type, p_plate text, p_capacity int, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not has_role('operations') then raise exception 'Only Operations can add vehicles.'; end if;
  insert into vehicles (type, plate, capacity_bags, note) values (p_type, upper(trim(p_plate)), p_capacity, p_note) returning id into v;
  return v;
exception when unique_violation then raise exception 'A vehicle with plate % already exists.', upper(trim(p_plate));
end $$;

create or replace function set_vehicle_status(p_vehicle uuid, p_status vehicle_status) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('operations') then raise exception 'Only Operations can change vehicles.'; end if;
  if p_status in ('under_repair','retired') then
    update riders set vehicle_id = null where vehicle_id = p_vehicle;
  end if;
  update vehicles set status = p_status where id = p_vehicle;
end $$;

create or replace function attach_vehicle(p_rider uuid, p_vehicle uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('operations') then raise exception 'Only Operations can attach vehicles.'; end if;
  if not exists (select 1 from riders where profile_id = p_rider) then raise exception 'Rider not found.'; end if;
  if p_vehicle is not null then
    if exists (select 1 from vehicles where id = p_vehicle and status in ('under_repair','retired')) then
      raise exception 'That vehicle is not in service.';
    end if;
    if exists (select 1 from riders where vehicle_id = p_vehicle and profile_id <> p_rider) then
      raise exception 'That vehicle already has a rider.';
    end if;
  end if;
  update vehicles set status = 'available'
    where id = (select vehicle_id from riders where profile_id = p_rider) and status = 'assigned';
  update riders set vehicle_id = p_vehicle where profile_id = p_rider;
  if p_vehicle is not null then update vehicles set status = 'assigned' where id = p_vehicle; end if;
end $$;

create or replace function set_rider(p_rider uuid, p_zone text, p_licence_expiry date, p_availability rider_availability) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('operations') then raise exception 'Only Operations can change riders.'; end if;
  update riders set zone = coalesce(p_zone, zone), licence_expiry = coalesce(p_licence_expiry, licence_expiry),
                    availability = coalesce(p_availability, availability)
  where profile_id = p_rider;
end $$;

-- A rider switches themselves on or off for the day (never to 'paused', which is Operations' call).
create or replace function set_my_availability(p_available boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('rider') then raise exception 'Only riders can do this.'; end if;
  update riders set availability = case when p_available then 'available' else 'off' end::rider_availability
  where profile_id = auth.uid() and availability in ('available','off');
end $$;

-- ---------------------------------------------------------------- settings (super admin)
create or replace function set_setting(p_key text, p_value jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('super_admin') then raise exception 'Only the super admin can change settings.'; end if;
  update settings set value = p_value where key = p_key;
  if not found then raise exception 'Unknown setting %.', p_key; end if;
end $$;

-- ---------------------------------------------------------------- counts for the super admin
-- Customers are counted, never listed, for the super admin.
create or replace function platform_counts() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when has_role('super_admin','operations') then jsonb_build_object(
    'businesses', (select count(*) from businesses where active),
    'customers', (select count(*) from profiles where role = 'customer' and status = 'active'),
    'riders', (select count(*) from riders r join profiles p on p.id = r.profile_id where p.status = 'active'),
    'riders_available', (select count(*) from riders r join profiles p on p.id = r.profile_id where p.status = 'active' and r.availability = 'available'),
    'vehicles', (select count(*) from vehicles where status <> 'retired'),
    'operations_staff', (select count(*) from profiles where role = 'operations' and status = 'active')
  ) end
$$;

-- ---------------------------------------------------------------- grants
revoke all on all functions in schema public from public, anon;
grant execute on function my_account(), touch_login(), password_changed(), update_my_profile(text,text),
  update_business(uuid,jsonb), set_business_active(uuid,boolean,text),
  create_vehicle(vehicle_type,text,int,text), set_vehicle_status(uuid,vehicle_status), attach_vehicle(uuid,uuid),
  set_rider(uuid,text,date,rider_availability), set_my_availability(boolean), set_setting(text,jsonb),
  platform_counts(), my_role(), has_role(app_role[]), my_business_id(), is_ops_lead(), setting(text), setting_num(text)
  to authenticated;
