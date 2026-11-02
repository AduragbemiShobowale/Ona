-- Ọ̀nà phases 3–5: delivery-fee payments by receipt, dispatch and routes, the three codes,
-- waiting charges, failed pickups and deliveries, rider changes, trip-only location, claims,
-- the issues feed, feedback, rider pay and the dashboards.

-- ---------------------------------------------------------------- types
create type request_status as enum ('awaiting_payment','payment_check','confirmed','closed','cancelled');
create type payment_status as enum ('pending','confirmed','rejected');
create type route_status as enum ('offered','active','done','cancelled');
create type stop_kind as enum ('pickup','drop','handover');
create type code_kind as enum ('pickup','delivery','handover');
create type claim_kind as enum ('damage','missing','loss');
create type claim_cause as enum ('rider','store','unclear');
create type claim_status as enum ('open','approved','rejected','paid');
create type issue_kind as enum ('complaint','failed_pickup','failed_delivery','code_locked','delay','rider_problem','rider_change','override','claim');

-- ---------------------------------------------------------------- payments (phase 3)
create sequence request_no_seq start 1001;
create table dispatch_requests (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default ('DSM-' || nextval('request_no_seq')),
  business_id uuid not null references businesses(id),
  total_fee numeric(12,2) not null,
  adjustments numeric(12,2) not null default 0,     -- waiting charges (+) and credits (−) carried in
  amount_due numeric(12,2) not null,
  status request_status not null default 'awaiting_payment',
  attempts int not null default 0,
  due_at timestamptz not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create index dispatch_requests_business_idx on dispatch_requests (business_id, created_at desc);

create table payments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references dispatch_requests(id),
  business_id uuid not null references businesses(id),
  amount numeric(12,2) not null check (amount > 0),
  reference text not null,
  receipt_path text not null,
  attempt int not null,
  status payment_status not null default 'pending',
  reject_reason text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index payments_status_idx on payments (status, created_at);

-- Credits (negative) and waiting charges (positive) carried to the business's next payment.
create table business_adjustments (
  id bigserial primary key,
  business_id uuid not null references businesses(id),
  kind text not null check (kind in ('credit','waiting_charge')),
  amount numeric(12,2) not null,
  order_id uuid references orders(id),
  reason text not null,
  request_id uuid references dispatch_requests(id),   -- set when used
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- dispatch (phase 4)
create sequence route_no_seq start 101;
create table routes (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default ('RT-' || nextval('route_no_seq')),
  rider_id uuid not null references profiles(id),
  vehicle_id uuid references vehicles(id),
  status route_status not null default 'offered',
  suggested boolean not null default false,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  finished_at timestamptz
);
create index routes_rider_idx on routes (rider_id, status);

create table route_stops (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references routes(id) on delete cascade,
  seq int not null,
  kind stop_kind not null,
  business_id uuid references businesses(id),     -- pickup stops
  order_id uuid references orders(id),            -- drop stops
  from_route_id uuid references routes(id),       -- handover stops: the route being taken over
  arrived_at timestamptz,
  done_at timestamptz,
  photo_path text,
  extra_time boolean not null default false,
  failed_reason text,
  waiting_charge numeric(12,2) not null default 0
);
create index route_stops_route_idx on route_stops (route_id, seq);

-- Codes are stored hashed. The code itself is derived from a secret only the database can read,
-- so it can be shown to the person who should read it out (owner: pickup; customer: delivery;
-- outgoing rider: handover) without ever being stored in plain text.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table private.secrets (key text primary key, value text not null);
insert into private.secrets values ('code_key', encode(extensions.gen_random_bytes(32), 'hex')) on conflict do nothing;

create table codes (
  id uuid primary key default gen_random_uuid(),
  kind code_kind not null,
  order_id uuid references orders(id) on delete cascade,
  stop_id uuid references route_stops(id) on delete cascade,
  code_hash text not null,
  failed_attempts int not null default 0,
  locked_at timestamptz,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index codes_order_idx on codes (order_id);
create index codes_stop_idx on codes (stop_id);

create table rider_locations (
  id bigserial primary key,
  route_id uuid not null references routes(id) on delete cascade,
  rider_id uuid not null references profiles(id),
  lat numeric(9,6) not null, lng numeric(9,6) not null,
  at timestamptz not null default now()
);
create index rider_locations_route_idx on rider_locations (route_id, at desc);

-- ---------------------------------------------------------------- claims, issues, feedback, pay (phase 5)
create table claims (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  business_id uuid not null references businesses(id),
  kind claim_kind not null,
  claimed_value numeric(12,2) not null check (claimed_value > 0),
  statement text not null,
  proof_path text,
  cause claim_cause,
  status claim_status not null default 'open',
  decision text,
  payout numeric(12,2),
  refund_reference text,
  opened_by uuid,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table issues (
  id bigserial primary key,
  kind issue_kind not null,
  order_id uuid references orders(id),
  business_id uuid references businesses(id),
  route_id uuid references routes(id),
  detail text not null,
  raised_by uuid,
  status text not null default 'open' check (status in ('open','resolved')),
  resolution text,
  resolved_by uuid,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index issues_status_idx on issues (status, created_at desc);

create table order_feedback (
  order_id uuid primary key references orders(id) on delete cascade,
  customer_id uuid not null references profiles(id),
  rating int not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

create table rider_payouts (
  id bigserial primary key,
  rider_id uuid not null references profiles(id),
  period text not null,
  trips int not null default 0,
  amount numeric(12,2) not null check (amount >= 0),
  reference text,
  status text not null default 'owed' check (status in ('owed','paid')),
  created_by uuid,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- helpers
create or replace function raise_issue(p_kind issue_kind, p_order uuid, p_detail text, p_route uuid default null) returns void
language sql security definer set search_path = public as $$
  insert into issues (kind, order_id, business_id, route_id, detail, raised_by)
  values (p_kind, p_order, (select business_id from orders where id = p_order), p_route, p_detail, auth.uid())
$$;

create or replace function code_value(p_code uuid) returns text
language sql stable security definer set search_path = public, extensions as $$
  select lpad(((('x' || substr(encode(extensions.hmac(p_code::text, (select value from private.secrets where key = 'code_key'), 'sha256'), 'hex'), 1, 8))::bit(32)::bigint % 1000000))::text, 6, '0')
$$;

create or replace function make_code(p_kind code_kind, p_order uuid, p_stop uuid) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare c uuid := gen_random_uuid();
begin
  insert into codes (id, kind, order_id, stop_id, code_hash) values (c, p_kind, p_order, p_stop, 'pending');
  update codes set code_hash = extensions.crypt(code_value(c), extensions.gen_salt('bf')) where id = c;
  return c;
end $$;

-- Checks a typed code. Wrong tries are counted and kept (the caller returns a message rather than raising),
-- and the code locks after code_max_attempts.
create or replace function check_code(p_code uuid, p_input text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare c codes;
begin
  select * into c from codes where id = p_code for update;
  if c.id is null then return 'missing'; end if;
  if c.used_at is not null then return 'used'; end if;
  if c.locked_at is not null then return 'locked'; end if;
  if c.code_hash = extensions.crypt(regexp_replace(coalesce(p_input,''), '\D', '', 'g'), c.code_hash) then
    update codes set used_at = now() where id = c.id;
    return 'ok';
  end if;
  update codes set failed_attempts = failed_attempts + 1,
                   locked_at = case when failed_attempts + 1 >= setting_num('code_max_attempts') then now() end
  where id = c.id;
  if c.failed_attempts + 1 >= setting_num('code_max_attempts') then
    perform raise_issue('code_locked', c.order_id, initcap(c.kind::text) || ' code locked after ' || (c.failed_attempts + 1) || ' wrong tries.');
    perform notify_role('operations', 'code_locked', initcap(c.kind::text) || ' code locked', 'A rider needs help. Verify by phone and override if right.', '/disputes');
    return 'locked';
  end if;
  return 'wrong:' || (setting_num('code_max_attempts') - c.failed_attempts - 1);
end $$;

create or replace function code_message(p_result text) returns jsonb
language sql immutable as $$
  select case when p_result = 'ok' then jsonb_build_object('ok', true)
              when p_result = 'locked' then jsonb_build_object('ok', false, 'message', 'The code is locked after too many wrong tries. Call Operations.')
              when p_result = 'used' then jsonb_build_object('ok', false, 'message', 'That code has already been used.')
              when p_result like 'wrong:%' then jsonb_build_object('ok', false, 'message', 'Wrong code. ' || split_part(p_result, ':', 2) || ' tries left.')
              else jsonb_build_object('ok', false, 'message', 'No code found for this stop.') end
$$;

create or replace function my_rider_route_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from routes where rider_id = auth.uid() and status in ('offered','active') order by created_at limit 1
$$;

-- ---------------------------------------------------------------- phase 3: payment by receipt
create or replace function request_dispatch(p_orders uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare b uuid := my_business_id(); r uuid; fees numeric; adj numeric; n int; bad text; rref text;
begin
  if b is null then raise exception 'Only a business owner can request dispatch.'; end if;
  if coalesce(array_length(p_orders, 1), 0) = 0 then raise exception 'Tick the packed orders to send.'; end if;
  select string_agg(ref, ', ') into bad from orders where id = any(p_orders) and (business_id <> b or status <> 'packed');
  if bad is not null then raise exception 'Only packed orders can be sent. Check %.', bad; end if;
  select count(*), sum(c.fee) into n, fees from orders o join order_charges c on c.order_id = o.id where o.id = any(p_orders) and o.business_id = b;
  if n <> array_length(p_orders, 1) then raise exception 'Some orders were not found.'; end if;
  select coalesce(sum(amount), 0) into adj from business_adjustments where business_id = b and request_id is null;
  insert into dispatch_requests (business_id, total_fee, adjustments, amount_due, due_at, created_by)
  values (b, fees, adj, greatest(0, fees + adj), now() + make_interval(hours => setting_num('payment_window_hours')::int), auth.uid())
  returning id, ref into r, rref;
  update business_adjustments set request_id = r where business_id = b and request_id is null;
  if fees + adj < 0 then  -- more credit than needed: carry the rest forward
    insert into business_adjustments (business_id, kind, amount, reason) values (b, 'credit', fees + adj, 'Credit left over from ' || rref);
  end if;
  update orders set request_id = r where id = any(p_orders);
  perform move_order(o, 'awaiting_payment', 'Dispatch requested: ' || rref) from unnest(p_orders) o;
  if fees + adj <= 0 then  -- fully covered by credit: no transfer needed
    update dispatch_requests set status = 'confirmed', confirmed_at = now() where id = r;
    perform move_order(o, 'payment_check', 'Covered by credit') from unnest(p_orders) o;
    perform release_to_dispatch(r);
  end if;
  return r;
end $$;

create or replace function submit_payment(p_request uuid, p_reference text, p_receipt_path text, p_amount numeric) returns void
language plpgsql security definer set search_path = public as $$
declare q dispatch_requests; o uuid;
begin
  select * into q from dispatch_requests where id = p_request and business_id = my_business_id() for update;
  if q.id is null then raise exception 'Dispatch request not found.'; end if;
  if q.status <> 'awaiting_payment' then raise exception 'This request is not waiting for payment.'; end if;
  if q.due_at < now() then perform expire_request(q.id); raise exception 'The 2-hour payment time ran out. Request dispatch again.'; end if;
  if length(trim(coalesce(p_reference,''))) < 4 then raise exception 'Enter the transfer reference from your bank app.'; end if;
  if coalesce(p_receipt_path,'') = '' then raise exception 'Upload the receipt.'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the amount you transferred.'; end if;
  update dispatch_requests set status = 'payment_check', attempts = attempts + 1 where id = q.id;
  insert into payments (request_id, business_id, amount, reference, receipt_path, attempt)
  values (q.id, q.business_id, p_amount, trim(p_reference), p_receipt_path, q.attempts + 1);
  for o in select id from orders where request_id = q.id loop
    perform move_order(o, 'payment_check', 'Receipt uploaded for ' || q.ref);
  end loop;
  perform notify_role('super_admin', 'receipt', 'Receipt to check: ' || q.ref,
    (select name from businesses where id = q.business_id) || ' paid ₦' || to_char(p_amount, 'FM999G999G990') || '. Target: confirm within 15 minutes.', '/payments');
end $$;

-- Paid orders go to Operations' queue; each gets its delivery code now.
create or replace function release_to_dispatch(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  for o in select * from orders where request_id = p_request loop
    perform move_order(o.id, 'ready_for_pickup', 'Delivery fee confirmed');
    if not exists (select 1 from codes where order_id = o.id and kind = 'delivery' and used_at is null) then
      perform make_code('delivery', o.id, null);
    end if;
    perform notify(o.customer_id, 'handed_over', 'Order ' || o.ref || ' is with Ọ̀nà', 'A rider will be assigned for your window.', '/orders/' || o.id);
  end loop;
  perform notify_role('operations', 'to_dispatch', 'New orders to dispatch', (select count(*) from orders where request_id = p_request) || ' paid order(s) are ready.', '/');
end $$;

create or replace function review_payment(p_payment uuid, p_approve boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare pay payments; q dispatch_requests; o uuid;
begin
  if not has_role('super_admin') then raise exception 'Only the super admin confirms payments.'; end if;
  select * into pay from payments where id = p_payment for update;
  if pay.id is null or pay.status <> 'pending' then raise exception 'This receipt has already been handled.'; end if;
  select * into q from dispatch_requests where id = pay.request_id for update;
  if p_approve then
    update payments set status = 'confirmed', decided_by = auth.uid(), decided_at = now() where id = pay.id;
    update dispatch_requests set status = 'confirmed', confirmed_at = now() where id = q.id;
    perform release_to_dispatch(q.id);
    perform notify_business(q.business_id, 'payment_confirmed', 'Payment confirmed: ' || q.ref, 'Your orders are in the dispatch queue.', '/payments');
  else
    if length(trim(coalesce(p_reason,''))) < 3 then raise exception 'Say why the receipt is rejected.'; end if;
    update payments set status = 'rejected', reject_reason = p_reason, decided_by = auth.uid(), decided_at = now() where id = pay.id;
    for o in select id from orders where request_id = q.id loop perform move_order(o, 'payment_rejected', p_reason); end loop;
    if q.attempts >= setting_num('max_receipt_attempts') then
      update dispatch_requests set status = 'closed' where id = q.id;
      update business_adjustments set request_id = null where request_id = q.id;
      for o in select id from orders where request_id = q.id loop perform move_order(o, 'packed', 'Request closed after 3 rejected receipts'); end loop;
      update orders set request_id = null where request_id = q.id;
      perform notify_business(q.business_id, 'request_closed', q.ref || ' closed', 'Three receipts were rejected. Your orders are back to Packed; request dispatch again.', '/payments');
    else
      -- the payment clock restarts for the re-upload
      update dispatch_requests set status = 'awaiting_payment', due_at = now() + make_interval(hours => setting_num('payment_window_hours')::int) where id = q.id;
      perform notify_business(q.business_id, 'payment_rejected', 'Receipt rejected: ' || q.ref, p_reason || '. Upload a new receipt.', '/payments');
    end if;
  end if;
  perform audit('payment', pay.id::text, case when p_approve then 'confirmed' else 'rejected' end, p_reason, null, null);
end $$;

create or replace function expire_request(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare q dispatch_requests; o uuid;
begin
  select * into q from dispatch_requests where id = p_request and status = 'awaiting_payment' for update;
  if q.id is null then return; end if;
  update dispatch_requests set status = 'closed' where id = q.id;
  update business_adjustments set request_id = null where request_id = q.id;
  for o in select id from orders where request_id = q.id loop
    perform move_order(o, case when (select status from orders where id = o) = 'payment_rejected' then 'packed' else 'packed' end::order_status, 'Payment time ran out');
  end loop;
  update orders set request_id = null where request_id = q.id;
  perform notify_business(q.business_id, 'request_expired', q.ref || ' expired', 'No receipt within 2 hours. Your orders are back to Packed.', '/payments');
end $$;

create or replace function cancel_request(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare q dispatch_requests; o uuid;
begin
  select * into q from dispatch_requests where id = p_request and business_id = my_business_id() for update;
  if q.id is null then raise exception 'Request not found.'; end if;
  if q.status not in ('awaiting_payment') then raise exception 'Only a request still waiting for payment can be withdrawn.'; end if;
  update dispatch_requests set status = 'cancelled' where id = q.id;
  update business_adjustments set request_id = null where request_id = q.id;
  for o in select id from orders where request_id = q.id loop perform move_order(o, 'packed', 'Dispatch request withdrawn'); end loop;
  update orders set request_id = null where request_id = q.id;
end $$;

-- Requests past their time limit close (run by the scheduler and whenever the payment screens load).
create or replace function expire_overdue_requests() returns int
language plpgsql security definer set search_path = public as $$
declare r uuid; n int := 0;
begin
  for r in select id from dispatch_requests where status = 'awaiting_payment' and due_at < now() loop
    perform expire_request(r); n := n + 1;
  end loop;
  return n;
end $$;

-- Cancelling a paid order before pickup turns its fee into credit.
create or replace function cancel_order_internal(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare o orders; paid boolean;
begin
  select * into o from orders where id = p_order;
  paid := o.status in ('ready_for_pickup','rider_assigned');
  perform move_order(o.id, 'cancelled', p_reason);
  perform release_stock(o.id, 'Cancelled: ' || p_reason);
  if paid then
    insert into business_adjustments (business_id, kind, amount, order_id, reason)
    select o.business_id, 'credit', -fee, o.id, 'Fee returned: ' || o.ref || ' cancelled before pickup' from order_charges where order_id = o.id;
    update codes set used_at = now() where order_id = o.id and used_at is null;
  end if;
  if o.status = 'awaiting_payment' and o.request_id is not null then
    update dispatch_requests set total_fee = total_fee - (select fee from order_charges where order_id = o.id),
                                 amount_due = greatest(0, amount_due - (select fee from order_charges where order_id = o.id))
    where id = o.request_id;
    update orders set request_id = null where id = o.id;
  end if;
  perform notify(o.customer_id, 'cancelled', 'Order ' || o.ref || ' was cancelled', p_reason, '/orders/' || o.id);
end $$;

-- ---------------------------------------------------------------- phase 4: dispatch
create or replace function vehicle_rank(v vehicle_type) returns int language sql immutable as $$
  select case v when 'bike' then 1 when 'car' then 2 when 'van' then 3 else 4 end
$$;

-- Riders who can take a route: active, available, vehicle big enough, licence in date.
create or replace function available_riders(p_vehicle vehicle_type default 'bike', p_bags int default 1)
returns table (rider_id uuid, full_name text, phone text, zone text, vehicle_type vehicle_type, plate text, capacity_bags int, licence_expiry date, trips_today int)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.phone, r.zone, v.type, v.plate, v.capacity_bags, r.licence_expiry,
         (select count(*)::int from routes x where x.rider_id = p.id and x.created_at::date = current_date)
  from riders r join profiles p on p.id = r.profile_id join vehicles v on v.id = r.vehicle_id
  where has_role('operations') and p.status = 'active' and r.availability = 'available'
    and v.status in ('assigned','available') and vehicle_rank(v.type) >= vehicle_rank(p_vehicle) and v.capacity_bags >= p_bags
    and (r.licence_expiry is null or r.licence_expiry >= current_date)
  order by vehicle_rank(v.type), p.full_name
$$;

-- Suggested combined routes: paid orders from businesses in the same pickup zone, dropping in the
-- same zone, in the same window. Operations accepts, edits or keeps them separate.
create or replace function suggest_routes() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when has_role('operations') then coalesce(jsonb_agg(g order by g->>'window_start'), '[]'::jsonb) end
  from (
    select jsonb_build_object(
      'order_ids', jsonb_agg(o.id order by o.created_at),
      'refs', jsonb_agg(o.ref order by o.created_at),
      'businesses', jsonb_agg(distinct b.name),
      'pickup_zone', coalesce(b.zone, '—'),
      'drop_zone', coalesce(o.zone, '—'),
      'window_start', o.window_start, 'window_end', min(o.window_end),
      'bags', sum(o.bags),
      'vehicle', (array['bike','car','van','truck'])[greatest(max(vehicle_rank(o.vehicle_type)),
                   case when sum(o.bags) > 12 then 4 when sum(o.bags) > 6 then 3 when sum(o.bags) > 3 then 2 else 1 end)],
      'combined', count(*) > 1) g
    from orders o join businesses b on b.id = o.business_id
    where o.status = 'ready_for_pickup'
    group by coalesce(b.zone, b.id::text), b.zone, o.zone, o.window_start
  ) s
$$;

create or replace function create_route(p_rider uuid, p_orders uuid[], p_suggested boolean default false, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare rt uuid; rref text; veh vehicles; rider profiles; need int; maxv int; bz uuid; s uuid; i int := 0; o orders; bad text;
begin
  if not has_role('operations') then raise exception 'Only Operations assigns riders.'; end if;
  if coalesce(array_length(p_orders,1),0) = 0 then raise exception 'Choose the orders for this route.'; end if;
  select string_agg(ref, ', ') into bad from orders where id = any(p_orders) and status <> 'ready_for_pickup';
  if bad is not null then raise exception 'These orders are not ready for pickup: %.', bad; end if;
  select * into rider from profiles where id = p_rider and role = 'rider' and status = 'active';
  if rider.id is null then raise exception 'Rider not found.'; end if;
  select v.* into veh from riders r join vehicles v on v.id = r.vehicle_id where r.profile_id = p_rider
    and r.availability = 'available' and (r.licence_expiry is null or r.licence_expiry >= current_date);
  if veh.id is null then raise exception '% is not available (off, paused, on a trip, no vehicle, or licence expired).', rider.full_name; end if;
  select sum(bags), max(vehicle_rank(vehicle_type)) into need, maxv from orders where id = any(p_orders);
  if need > veh.capacity_bags then raise exception 'That is % bags; % (%) carries %.', need, rider.full_name, veh.plate, veh.capacity_bags; end if;
  if vehicle_rank(veh.type) < maxv then raise exception 'These orders need a bigger vehicle than a %.', veh.type; end if;

  insert into routes (rider_id, vehicle_id, suggested, note, created_by) values (p_rider, veh.id, p_suggested, p_note, auth.uid()) returning id, ref into rt, rref;
  -- one pickup stop (and one pickup code) per business on the route
  for bz in select business_id from orders where id = any(p_orders) group by business_id order by min(created_at) loop
    i := i + 1;
    insert into route_stops (route_id, seq, kind, business_id) values (rt, i, 'pickup', bz) returning id into s;
    perform make_code('pickup', null, s);
  end loop;
  for o in select * from orders where id = any(p_orders) order by window_end, created_at loop
    i := i + 1;
    insert into route_stops (route_id, seq, kind, order_id) values (rt, i, 'drop', o.id);
    update orders set route_id = rt, rider_id = p_rider where id = o.id;
    perform move_order(o.id, 'rider_assigned', 'Route ' || rref || ' to ' || rider.full_name);
    perform notify(o.customer_id, 'rider_assigned', 'Rider assigned for ' || o.ref,
      rider.full_name || ' · ' || initcap(veh.type::text) || ' ' || veh.plate, '/orders/' || o.id);
  end loop;
  for bz in select distinct business_id from orders where id = any(p_orders) loop
    perform notify_business(bz, 'rider_assigned', 'Rider on the way: ' || rider.full_name,
      initcap(veh.type::text) || ' ' || veh.plate || '. Have the bags ready and the pickup code to hand.', '/');
  end loop;
  update riders set availability = 'on_trip' where profile_id = p_rider;
  perform notify(p_rider, 'route_offered', 'New route ' || rref, i || ' stops. Open My route to accept.', '/');
  return rt;
end $$;

create or replace function respond_route(p_route uuid, p_accept boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare rt routes; o uuid;
begin
  select * into rt from routes where id = p_route and rider_id = auth.uid() and status = 'offered' for update;
  if rt.id is null then raise exception 'Route not found.'; end if;
  if p_accept then
    update routes set status = 'active', accepted_at = now() where id = rt.id;
    update vehicles set status = 'in_use' where id = rt.vehicle_id;
  else
    update routes set status = 'cancelled', finished_at = now(), note = coalesce(note || ' · ', '') || 'Declined: ' || coalesce(p_reason, 'no reason') where id = rt.id;
    for o in select order_id from route_stops where route_id = rt.id and kind = 'drop' loop
      perform move_order(o, 'ready_for_pickup', 'Rider declined the route');
      update orders set route_id = null, rider_id = null where id = o;
    end loop;
    update riders set availability = 'available' where profile_id = auth.uid();
    perform notify_role('operations', 'route_declined', rt.ref || ' declined', coalesce(p_reason, 'No reason given') || '. Reassign the orders.', '/');
  end if;
end $$;

-- Arrival check-in: within about 150 m of the pin when both are known.
create or replace function arrive_stop(p_stop uuid, p_lat numeric default null, p_lng numeric default null) returns void
language plpgsql security definer set search_path = public as $$
declare st route_stops; rt routes; b businesses; o orders; d numeric;
begin
  select * into st from route_stops where id = p_stop for update;
  select * into rt from routes where id = st.route_id;
  if rt.id is null or rt.rider_id <> auth.uid() or rt.status <> 'active' then raise exception 'Accept the route first.'; end if;
  if st.arrived_at is not null then return; end if;
  if st.kind = 'pickup' then
    select * into b from businesses where id = st.business_id;
    d := distance_km(b.pickup_lat, b.pickup_lng, p_lat, p_lng);
    if d is not null and d > 0.15 then raise exception 'You are about % m from the shop. Check in when you get there.', round(d * 1000); end if;
    update route_stops set arrived_at = now() where id = st.id;
    for o in select * from orders where route_id = rt.id and business_id = st.business_id and status = 'rider_assigned' loop
      perform move_order(o.id, 'rider_at_shop', 'Rider checked in');
    end loop;
    perform notify_business(st.business_id, 'rider_at_shop', (select full_name from profiles where id = auth.uid()) || ' is at your door',
      'The 10 free minutes have started. Hand over the bags and read out the pickup code.', '/');
  else
    select * into o from orders where id = coalesce(st.order_id, (select order_id from route_stops where id = st.id));
    d := distance_km(o.drop_lat, o.drop_lng, p_lat, p_lng);
    if d is not null and d > 0.3 then raise exception 'You are about % m from the drop-off.', round(d * 1000); end if;
    update route_stops set arrived_at = now() where id = st.id;
    if o.id is not null then perform notify(o.customer_id, 'rider_arrived', 'Your rider is outside', 'Check the items, then give your delivery code.', '/orders/' || o.id); end if;
  end if;
end $$;

create or replace function owner_more_time(p_stop uuid) returns void
language plpgsql security definer set search_path = public as $$
declare st route_stops;
begin
  select * into st from route_stops where id = p_stop and business_id = my_business_id() and kind = 'pickup' for update;
  if st.id is null then raise exception 'Pickup not found.'; end if;
  if st.arrived_at is null then raise exception 'The rider has not arrived yet.'; end if;
  if st.extra_time then raise exception 'You have already asked for more time once.'; end if;
  update route_stops set extra_time = true where id = st.id;
  perform notify_role('operations', 'more_time', 'Shop asked for 10 more minutes', (select name from businesses where id = st.business_id), '/trips');
end $$;

create or replace function waiting_charge_for(p_minutes numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select case when p_minutes <= setting_num('waiting_free_minutes') then 0
              else ceil((p_minutes - setting_num('waiting_free_minutes')) / setting_num('waiting_block_minutes')) * setting_num('waiting_rate') end
$$;

-- Rider confirms the pickup: photo, bag count and the code the owner reads out.
create or replace function confirm_pickup(p_stop uuid, p_code text, p_bags int, p_photo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare st route_stops; rt routes; need int; res text; c uuid; o orders; i record; mins numeric; charge numeric;
begin
  select * into st from route_stops where id = p_stop for update;
  select * into rt from routes where id = st.route_id;
  if rt.id is null or rt.rider_id <> auth.uid() or rt.status <> 'active' or st.kind <> 'pickup' then raise exception 'Pickup not found.'; end if;
  if st.done_at is not null then raise exception 'Already picked up.'; end if;
  if st.arrived_at is null then raise exception 'Tap Arrived first.'; end if;
  if coalesce(p_photo, '') = '' then raise exception 'Photograph the bags first.'; end if;
  select sum(bags) into need from orders where route_id = rt.id and business_id = st.business_id and status = 'rider_at_shop';
  if coalesce(p_bags, 0) <> need then
    perform raise_issue('rider_problem', (select id from orders where route_id = rt.id and business_id = st.business_id limit 1),
      'Bag count mismatch at pickup: expected ' || need || ', counted ' || coalesce(p_bags, 0), rt.id);
    return jsonb_build_object('ok', false, 'message', 'The label says ' || need || ' bags. Don''t type the code; ask the shop to fix the count, or call Operations.');
  end if;
  select id into c from codes where stop_id = st.id and kind = 'pickup' order by created_at desc limit 1;
  res := check_code(c, p_code);
  if res <> 'ok' then return code_message(res); end if;

  mins := extract(epoch from now() - st.arrived_at) / 60;
  charge := waiting_charge_for(mins);
  update route_stops set done_at = now(), photo_path = p_photo, waiting_charge = charge where id = st.id;
  if charge > 0 then
    insert into business_adjustments (business_id, kind, amount, reason)
    values (st.business_id, 'waiting_charge', charge, 'Waiting ' || round(mins) || ' min at pickup on ' || rt.ref);
  end if;
  for o in select * from orders where route_id = rt.id and business_id = st.business_id and status = 'rider_at_shop' loop
    for i in select product_id, qty from order_items where order_id = o.id loop
      update products set on_hand = on_hand - i.qty, reserved = greatest(0, reserved - i.qty) where id = i.product_id;
      insert into stock_movements (business_id, product_id, kind, qty, reason, order_id, by_user)
      values (o.business_id, i.product_id, 'dispatch', -i.qty, 'Collected for ' || o.ref, o.id, auth.uid());
    end loop;
    perform move_order(o.id, 'out_for_delivery', 'Picked up with code');
    perform notify(o.customer_id, 'picked_up', 'Picked up: ' || o.ref, 'Your order is on its way. Have your delivery code ready.', '/orders/' || o.id, true);
  end loop;
  if charge > 0 then
    update order_charges set waiting_charge = waiting_charge + charge / greatest(1, (select count(*) from orders where route_id = rt.id and business_id = st.business_id))
    where order_id in (select id from orders where route_id = rt.id and business_id = st.business_id);
  end if;
  return jsonb_build_object('ok', true, 'waiting_charge', charge);
end $$;

-- Failed pickup after the wait (20 min, or 30 if the shop asked for more time), or at once if the shop is closed.
create or replace function fail_pickup(p_stop uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare st route_stops; rt routes; o orders; mins numeric; lim numeric;
begin
  select * into st from route_stops where id = p_stop for update;
  select * into rt from routes where id = st.route_id;
  if rt.id is null or rt.rider_id <> auth.uid() or st.kind <> 'pickup' or st.done_at is not null then raise exception 'Pickup not found.'; end if;
  if st.arrived_at is null then raise exception 'Tap Arrived first.'; end if;
  if p_reason not in ('Shop closed','Parcel not ready','Bags don''t match label','Owner unreachable') then raise exception 'Choose a reason.'; end if;
  mins := extract(epoch from now() - st.arrived_at) / 60;
  lim := setting_num('failed_pickup_after_minutes') + case when st.extra_time then 10 else 0 end;
  if p_reason not in ('Shop closed') and mins < lim then raise exception 'Wait until % minutes have passed (now %).', lim, floor(mins); end if;
  update route_stops set done_at = now(), failed_reason = p_reason where id = st.id;
  for o in select * from orders where route_id = rt.id and business_id = st.business_id and status = 'rider_at_shop' loop
    perform move_order(o.id, 'failed_pickup', p_reason);
    update route_stops set done_at = now(), failed_reason = 'Not collected' where route_id = rt.id and order_id = o.id;
    perform raise_issue('failed_pickup', o.id, p_reason, rt.id);
    perform notify(o.customer_id, 'pickup_delay', 'Short delay at the shop', 'New time to follow for ' || o.ref || '.', '/orders/' || o.id);
  end loop;
  perform notify_business(st.business_id, 'failed_pickup', 'Pickup failed: ' || p_reason, 'Operations will contact you.', '/');
  perform notify_role('operations', 'failed_pickup', 'Failed pickup', (select name from businesses where id = st.business_id) || ': ' || p_reason, '/disputes');
  perform finish_route_if_done(rt.id);
end $$;

-- Operations settles a failed pickup: business-caused goes back to Packed (new fee); rider-caused is reassigned free.
create or replace function resolve_failed_pickup(p_order uuid, p_cause text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  if not has_role('operations') then raise exception 'Only Operations can do this.'; end if;
  select * into o from orders where id = p_order and status = 'failed_pickup';
  if o.id is null then raise exception 'Order is not a failed pickup.'; end if;
  update orders set route_id = null, rider_id = null where id = o.id;
  if p_cause = 'business' then
    perform move_order(o.id, 'packed', 'Failed pickup caused by the business: fee kept. ' || coalesce(p_note,''));
    update orders set request_id = null where id = o.id;
    update codes set used_at = now() where order_id = o.id and kind = 'delivery' and used_at is null;
    perform notify_business(o.business_id, 'failed_pickup', o.ref || ' is back to Packed', 'The fee was kept. Request dispatch again when it is ready.', '/');
  elsif p_cause = 'rider' then
    perform move_order(o.id, 'ready_for_pickup', 'Failed pickup caused by Ọ̀nà: reassigned free. ' || coalesce(p_note,''));
  else raise exception 'Choose business or rider.'; end if;
  update issues set status = 'resolved', resolution = p_cause || ': ' || coalesce(p_note,''), resolved_by = auth.uid(), resolved_at = now()
  where order_id = o.id and kind = 'failed_pickup' and status = 'open';
end $$;

create or replace function deliver_order(p_order uuid, p_code text, p_photo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o orders; c uuid; res text;
begin
  select * into o from orders where id = p_order and rider_id = auth.uid() for update;
  if o.id is null or o.status <> 'out_for_delivery' then raise exception 'This order is not out for delivery with you.'; end if;
  if coalesce(p_photo,'') = '' then raise exception 'Photograph the handover first.'; end if;
  select id into c from codes where order_id = o.id and kind = 'delivery' order by created_at desc limit 1;
  res := check_code(c, p_code);
  if res <> 'ok' then return code_message(res); end if;
  perform complete_delivery(o.id, p_photo, 'Delivered with code');
  return jsonb_build_object('ok', true);
end $$;

create or replace function complete_delivery(p_order uuid, p_photo text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = p_order;
  perform move_order(o.id, 'delivered', p_reason);
  update route_stops set done_at = now(), photo_path = coalesce(p_photo, photo_path), arrived_at = coalesce(arrived_at, now())
  where route_id = o.route_id and order_id = o.id;
  perform notify(o.customer_id, 'delivered', 'Delivered: ' || o.ref, 'Thanks for receiving it. Rate your delivery.', '/orders/' || o.id, true);
  perform notify_business(o.business_id, 'delivered', o.ref || ' delivered', coalesce(o.customer_name, o.customer_email) ||
    case when o.delivered_at is null and now() > o.window_end then ' · late' else '' end, '/');
  perform finish_route_if_done(o.route_id);
end $$;

create or replace function finish_route_if_done(p_route uuid) returns void
language plpgsql security definer set search_path = public as $$
declare rt routes;
begin
  select * into rt from routes where id = p_route;
  if rt.id is null or rt.status not in ('active','offered') then return; end if;
  if not exists (select 1 from route_stops where route_id = rt.id and done_at is null) then
    update routes set status = 'done', finished_at = now() where id = rt.id;
    update riders set availability = 'available' where profile_id = rt.rider_id and availability = 'on_trip';
    update vehicles set status = 'assigned' where id = rt.vehicle_id and status = 'in_use';
  end if;
end $$;

create or replace function fail_delivery(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = p_order and rider_id = auth.uid();
  if o.id is null or o.status <> 'out_for_delivery' then raise exception 'This order is not out for delivery with you.'; end if;
  if p_reason not in ('Customer not home','Customer unreachable','Customer refused an item','Wrong address','Unsafe to deliver') then raise exception 'Choose a reason.'; end if;
  perform move_order(o.id, 'failed_delivery', p_reason);
  update route_stops set done_at = now(), failed_reason = p_reason where route_id = o.route_id and order_id = o.id;
  perform raise_issue(case when p_reason = 'Customer refused an item' then 'complaint' else 'failed_delivery' end::issue_kind, o.id, p_reason, o.route_id);
  perform notify(o.customer_id, 'failed_delivery', 'We couldn''t deliver ' || o.ref, p_reason || '. The parcel goes back to the business.', '/orders/' || o.id, true);
  perform notify_business(o.business_id, 'failed_delivery', 'Delivery failed: ' || o.ref, p_reason, '/');
  perform notify_role('operations', 'failed_delivery', 'Failed delivery ' || o.ref, p_reason, '/disputes');
  perform finish_route_if_done(o.route_id);
end $$;

-- Operations: customer-caused goes back to the business (new fee to re-deliver); Ọ̀nà-caused is re-delivered free.
create or replace function resolve_failed_delivery(p_order uuid, p_cause text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  if not has_role('operations') then raise exception 'Only Operations can do this.'; end if;
  select * into o from orders where id = p_order and status = 'failed_delivery';
  if o.id is null then raise exception 'Order is not a failed delivery.'; end if;
  update orders set route_id = null, rider_id = null where id = o.id;
  if p_cause = 'customer' then
    perform move_order(o.id, 'returned', 'Returned to the business (customer-caused). ' || coalesce(p_note,''));
    perform notify_business(o.business_id, 'returned', o.ref || ' returned to you', 'Re-delivery needs a new order and fee.', '/');
  elsif p_cause = 'ona' then
    perform move_order(o.id, 'ready_for_pickup', 'Free re-delivery (Ọ̀nà-caused). ' || coalesce(p_note,''));
  else raise exception 'Choose customer or Ọ̀nà.'; end if;
  update issues set status = 'resolved', resolution = p_cause || ': ' || coalesce(p_note,''), resolved_by = auth.uid(), resolved_at = now()
  where order_id = o.id and kind in ('failed_delivery','complaint') and status = 'open';
end $$;

-- Code locked or the customer's phone is dead: Operations verifies by phone and records delivery, with a reason.
create or replace function override_delivery(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  if not has_role('operations') then raise exception 'Only Operations can override a delivery code.'; end if;
  if length(trim(coalesce(p_reason,''))) < 10 then raise exception 'Say how you verified the customer (at least 10 characters).'; end if;
  select * into o from orders where id = p_order and status = 'out_for_delivery';
  if o.id is null then raise exception 'Order is not out for delivery.'; end if;
  update codes set used_at = now() where order_id = o.id and kind = 'delivery' and used_at is null;
  perform complete_delivery(o.id, null, 'Operations override: ' || p_reason);
  perform raise_issue('override', o.id, 'Delivery recorded by Operations: ' || p_reason, o.route_id);
  update issues set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(), resolution = 'Overridden'
  where order_id = o.id and kind in ('code_locked','override') and status = 'open';
  perform audit('order', o.id::text, 'delivery_override', p_reason, null, null);
end $$;

-- Rider change mid-trip: the remaining orders move to a new rider through a handover code.
create or replace function change_rider(p_route uuid, p_new_rider uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public as $$
declare rt routes; nr uuid; veh vehicles; s uuid; o orders; i int := 1; who profiles; nref text;
begin
  if not has_role('operations') then raise exception 'Only Operations can change riders.'; end if;
  if length(trim(coalesce(p_reason,''))) < 3 then raise exception 'Give the reason for the change.'; end if;
  select * into rt from routes where id = p_route and status = 'active' for update;
  if rt.id is null then raise exception 'Route is not active.'; end if;
  if not exists (select 1 from orders where route_id = rt.id and status = 'out_for_delivery') then raise exception 'No orders on the road to hand over.'; end if;
  select v.* into veh from riders r join vehicles v on v.id = r.vehicle_id where r.profile_id = p_new_rider and r.availability = 'available';
  if veh.id is null then raise exception 'That rider is not available.'; end if;
  select * into who from profiles where id = p_new_rider;
  insert into routes (rider_id, vehicle_id, status, note, created_by, accepted_at)
  values (p_new_rider, veh.id, 'active', 'Handover from ' || rt.ref || ': ' || p_reason, auth.uid(), now()) returning id, ref into nr, nref;
  insert into route_stops (route_id, seq, kind, from_route_id) values (nr, 1, 'handover', rt.id) returning id into s;
  perform make_code('handover', null, s);
  for o in select * from orders where route_id = rt.id and status = 'out_for_delivery' order by window_end loop
    i := i + 1;
    perform move_order(o.id, 'rider_changing', p_reason);
    update route_stops set done_at = now(), failed_reason = 'Handed over to ' || nref where route_id = rt.id and order_id = o.id;
    insert into route_stops (route_id, seq, kind, order_id) values (nr, i, 'drop', o.id);
    update orders set route_id = nr, rider_id = p_new_rider where id = o.id;
    perform notify(o.customer_id, 'rider_changed', 'Your rider has changed',
      'Now ' || who.full_name || ' · ' || initcap(veh.type::text) || ' ' || veh.plate || ' because of ' || lower(p_reason) || '. Your delivery code stays the same.', '/orders/' || o.id);
    perform notify_business(o.business_id, 'rider_changed', 'Rider changed on ' || o.ref, who.full_name || ' · ' || veh.plate || ': ' || p_reason, '/');
    perform raise_issue('rider_change', o.id, p_reason, rt.id);
  end loop;
  update riders set availability = 'on_trip' where profile_id = p_new_rider;
  update vehicles set status = 'in_use' where id = veh.id;
  perform notify(p_new_rider, 'handover', 'Handover: go to ' || (select full_name from profiles where id = rt.rider_id), 'Collect the bags, photograph them and type the handover code.', '/');
  perform notify(rt.rider_id, 'handover', 'Hand your bags to ' || who.full_name, 'Show them the handover code on your screen.', '/');
  return nr;
end $$;

create or replace function accept_handover(p_stop uuid, p_code text, p_photo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare st route_stops; rt routes; old routes; c uuid; res text; o uuid;
begin
  select * into st from route_stops where id = p_stop and kind = 'handover' for update;
  select * into rt from routes where id = st.route_id;
  if rt.id is null or rt.rider_id <> auth.uid() or st.done_at is not null then raise exception 'Handover not found.'; end if;
  if coalesce(p_photo,'') = '' then raise exception 'Photograph the bags first.'; end if;
  select id into c from codes where stop_id = st.id and kind = 'handover' order by created_at desc limit 1;
  res := check_code(c, p_code);
  if res <> 'ok' then return code_message(res); end if;
  update route_stops set arrived_at = coalesce(arrived_at, now()), done_at = now(), photo_path = p_photo where id = st.id;
  for o in select order_id from route_stops where route_id = rt.id and kind = 'drop' loop
    perform move_order(o, 'out_for_delivery', 'Handover complete');
  end loop;
  select * into old from routes where id = st.from_route_id;
  update route_stops set done_at = coalesce(done_at, now()) where route_id = old.id;
  perform finish_route_if_done(old.id);
  return jsonb_build_object('ok', true);
end $$;

-- Congestion notice: a new estimate past the window end tells the customer and the business.
create or replace function report_delay(p_order uuid, p_eta timestamptz, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = p_order;
  if o.id is null or not (has_role('operations') or o.rider_id = auth.uid()) then raise exception 'Order not found.'; end if;
  if o.status not in ('rider_assigned','rider_at_shop','out_for_delivery','rider_changing') then raise exception 'The order is not on the road.'; end if;
  update orders set eta = p_eta, late_reason = case when p_eta > window_end then coalesce(nullif(trim(p_reason),''), 'traffic') else late_reason end where id = o.id;
  if p_eta > o.window_end then
    perform notify(o.customer_id, 'delay', coalesce(nullif(trim(p_reason),''), 'Heavy traffic'),
      'New estimate ' || to_char(p_eta at time zone 'Africa/Lagos', 'HH12:MIam') || ' for ' || o.ref || '.', '/orders/' || o.id);
    perform notify_business(o.business_id, 'delay', 'Late: ' || o.ref, coalesce(p_reason, 'traffic') || '. New estimate ' || to_char(p_eta at time zone 'Africa/Lagos', 'HH12:MIam'), '/');
    perform raise_issue('delay', o.id, coalesce(p_reason, 'traffic') || ' · new estimate ' || to_char(p_eta at time zone 'Africa/Lagos', 'HH24:MI'), o.route_id);
  end if;
end $$;

create or replace function report_problem(p_detail text) returns void
language plpgsql security definer set search_path = public as $$
declare r uuid := my_rider_route_id();
begin
  if not has_role('rider') or r is null then raise exception 'No open route.'; end if;
  if length(trim(coalesce(p_detail,''))) < 5 then raise exception 'Describe the problem.'; end if;
  insert into issues (kind, route_id, detail, raised_by) values ('rider_problem', r, p_detail, auth.uid());
  perform notify_role('operations', 'rider_problem', 'Rider problem', (select full_name from profiles where id = auth.uid()) || ': ' || p_detail, '/trips');
end $$;

-- Location only while a trip is open.
create or replace function ping_location(p_lat numeric, p_lng numeric) returns void
language plpgsql security definer set search_path = public as $$
declare r uuid;
begin
  select id into r from routes where rider_id = auth.uid() and status = 'active' limit 1;
  if r is null then return; end if;
  insert into rider_locations (route_id, rider_id, lat, lng) values (r, auth.uid(), p_lat, p_lng);
end $$;

create or replace function purge_old_locations() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from rider_locations where at < now() - make_interval(days => setting_num('location_retention_days')::int);
  get diagnostics n = row_count; return n;
end $$;

-- ---------------------------------------------------------------- what each person may see of a trip
-- Rider: the open route with what the job needs (customer name, phone and address only for this job). No prices, no codes,
-- except the handover code on the outgoing rider's screen (spec section 6).
create or replace function rider_route() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when has_role('rider') then (
    select jsonb_build_object('route', to_jsonb(rt), 'stops', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'seq', s.seq, 'kind', s.kind, 'arrived_at', s.arrived_at, 'done_at', s.done_at, 'failed_reason', s.failed_reason, 'extra_time', s.extra_time,
        'business', case when s.kind = 'pickup' then jsonb_build_object('name', b.name, 'phone', b.phone, 'address', b.pickup_address,
                     'landmark', b.pickup_landmark, 'lat', b.pickup_lat, 'lng', b.pickup_lng,
                     'bags', (select sum(bags) from orders x where x.route_id = rt.id and x.business_id = s.business_id and x.status in ('rider_assigned','rider_at_shop')),
                     'orders', (select jsonb_agg(x.ref) from orders x where x.route_id = rt.id and x.business_id = s.business_id)) end,
        'order', case when s.kind = 'drop' then jsonb_build_object('id', o.id, 'ref', o.ref, 'status', o.status, 'bags', o.bags,
                     'window_start', o.window_start, 'window_end', o.window_end,
                     'customer', coalesce(o.customer_name, cp.full_name), 'phone', coalesce(o.drop_phone, cp.phone),
                     'address', o.drop_address, 'landmark', o.drop_landmark, 'lat', o.drop_lat, 'lng', o.drop_lng, 'zone', o.zone) end,
        'handover', case when s.kind = 'handover' then jsonb_build_object('from', (select full_name from profiles where id = (select rider_id from routes where id = s.from_route_id))) end
      ) order by s.seq)
      from route_stops s left join businesses b on b.id = s.business_id left join orders o on o.id = s.order_id left join profiles cp on cp.id = o.customer_id
      where s.route_id = rt.id), '[]'::jsonb),
      'handover_out', (select jsonb_build_object('to', np.full_name, 'code', code_value(c.id), 'route', nr.ref)
                       from route_stops hs join routes nr on nr.id = hs.route_id join profiles np on np.id = nr.rider_id
                       join codes c on c.stop_id = hs.id and c.kind = 'handover' and c.used_at is null
                       where hs.from_route_id = rt.id and hs.done_at is null limit 1)
    )
    from routes rt where rt.rider_id = auth.uid() and (rt.status in ('offered','active')
      or exists (select 1 from route_stops hs where hs.from_route_id = rt.id and hs.done_at is null))
    order by (rt.status = 'active') desc, rt.created_at limit 1
  ) end
$$;

create or replace function rider_history() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'finished_at' desc), '[]'::jsonb) from (
    select jsonb_build_object('ref', rt.ref, 'finished_at', rt.finished_at, 'status', rt.status,
      'drops', (select count(*) from route_stops s where s.route_id = rt.id and s.kind = 'drop'),
      'delivered', (select count(*) from route_stops s join orders o on o.id = s.order_id where s.route_id = rt.id and o.status in ('delivered','claim_open'))) x
    from routes rt where rt.rider_id = auth.uid() and rt.status in ('done','cancelled') order by rt.created_at desc limit 50
  ) s where has_role('rider')
$$;

-- Owner or customer: rider details, live position, estimate and the right code for this person.
create or replace function order_tracking(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o orders; is_owner boolean; is_customer boolean; res jsonb;
begin
  select * into o from orders where id = p_order;
  is_owner := o.business_id = my_business_id();
  is_customer := o.customer_id = auth.uid() and has_role('customer');
  if o.id is null or not (is_owner or is_customer or has_role('operations')) then return null; end if;
  select jsonb_build_object(
    'status', o.status, 'eta', o.eta, 'late_reason', o.late_reason, 'window_start', o.window_start, 'window_end', o.window_end,
    'rider', (select jsonb_build_object('name', p.full_name, 'phone', case when is_customer or has_role('operations') then p.phone end,
                     'vehicle', v.type, 'plate', v.plate)
              from profiles p left join routes rt on rt.id = o.route_id left join vehicles v on v.id = rt.vehicle_id where p.id = o.rider_id),
    'location', case when o.status in ('rider_assigned','rider_at_shop','out_for_delivery','rider_changing') then
                  (select jsonb_build_object('lat', l.lat, 'lng', l.lng, 'at', l.at) from rider_locations l where l.route_id = o.route_id order by l.at desc limit 1) end,
    'pickup', (select jsonb_build_object('lat', b.pickup_lat, 'lng', b.pickup_lng, 'name', b.name) from businesses b where b.id = o.business_id),
    'drop', jsonb_build_object('lat', o.drop_lat, 'lng', o.drop_lng),
    'delivery_code', case when is_customer and o.status in ('ready_for_pickup','rider_assigned','rider_at_shop','out_for_delivery','rider_changing')
                       then (select code_value(c.id) from codes c where c.order_id = o.id and c.kind = 'delivery' and c.used_at is null order by c.created_at desc limit 1) end,
    'code_locked', exists (select 1 from codes c where c.order_id = o.id and c.kind = 'delivery' and c.locked_at is not null and c.used_at is null),
    'pickup_code', case when is_owner and o.status in ('rider_assigned','rider_at_shop')
                     then (select code_value(c.id) from route_stops s join codes c on c.stop_id = s.id and c.kind = 'pickup' and c.used_at is null
                           where s.route_id = o.route_id and s.business_id = o.business_id limit 1) end,
    'pickup_stop', case when is_owner then (select jsonb_build_object('id', s.id, 'arrived_at', s.arrived_at, 'extra_time', s.extra_time)
                     from route_stops s where s.route_id = o.route_id and s.business_id = o.business_id and s.kind = 'pickup' limit 1) end,
    'pickup_photo', case when is_owner or has_role('operations') then (select s.photo_path from route_stops s where s.route_id is not null and s.business_id = o.business_id and s.kind = 'pickup' and s.route_id in (select route_id from route_stops where order_id = o.id) order by s.done_at desc nulls last limit 1) end,
    'drop_photo', case when is_owner or has_role('operations') then (select s.photo_path from route_stops s where s.order_id = o.id and s.photo_path is not null order by s.done_at desc limit 1) end,
    'feedback', (select to_jsonb(f) from order_feedback f where f.order_id = o.id)
  ) into res;
  return res;
end $$;

-- The pickups a business is expecting now, with the code to read out.
create or replace function owner_pickups() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'stop_id', s.id, 'route', rt.ref, 'arrived_at', s.arrived_at, 'extra_time', s.extra_time,
    'rider', p.full_name, 'vehicle', v.type, 'plate', v.plate, 'route_status', rt.status,
    'code', code_value(c.id),
    'bags', (select sum(bags) from orders o where o.route_id = rt.id and o.business_id = s.business_id and o.status in ('rider_assigned','rider_at_shop')),
    'orders', (select jsonb_agg(o.ref) from orders o where o.route_id = rt.id and o.business_id = s.business_id and o.status in ('rider_assigned','rider_at_shop')))
    order by s.arrived_at nulls last), '[]'::jsonb)
  from route_stops s join routes rt on rt.id = s.route_id join profiles p on p.id = rt.rider_id
  left join vehicles v on v.id = rt.vehicle_id
  join codes c on c.stop_id = s.id and c.kind = 'pickup' and c.used_at is null and c.locked_at is null
  where s.kind = 'pickup' and s.done_at is null and s.business_id = my_business_id() and rt.status in ('offered','active')
$$;

-- Live trips for Operations and the super admin.
create or replace function live_trips() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when has_role('operations','super_admin') then coalesce(jsonb_agg(jsonb_build_object(
    'id', rt.id, 'ref', rt.ref, 'status', rt.status, 'rider', p.full_name, 'rider_id', p.id, 'phone', p.phone, 'vehicle', v.type, 'plate', v.plate,
    'accepted_at', rt.accepted_at, 'created_at', rt.created_at,
    'stops_total', (select count(*) from route_stops s where s.route_id = rt.id),
    'stops_done', (select count(*) from route_stops s where s.route_id = rt.id and s.done_at is not null),
    'location', (select jsonb_build_object('lat', l.lat, 'lng', l.lng, 'at', l.at) from rider_locations l where l.route_id = rt.id order by l.at desc limit 1),
    'waiting_since', (select min(s.arrived_at) from route_stops s where s.route_id = rt.id and s.kind = 'pickup' and s.arrived_at is not null and s.done_at is null),
    'orders', (select jsonb_agg(jsonb_build_object('id', o.id, 'ref', o.ref, 'status', o.status, 'window_end', o.window_end, 'eta', o.eta,
                 'zone', o.zone, 'business', b.name,
                 'code_locked', exists (select 1 from codes c where c.order_id = o.id and c.locked_at is not null and c.used_at is null)) order by o.window_end)
               from orders o join businesses b on b.id = o.business_id where o.route_id = rt.id)
  ) order by rt.created_at desc), '[]'::jsonb) end
  from routes rt join profiles p on p.id = rt.rider_id left join vehicles v on v.id = rt.vehicle_id
  where rt.status in ('offered','active')
$$;

-- ---------------------------------------------------------------- phase 5: claims, feedback, prompts, pay
create or replace function open_claim(p_order uuid, p_kind claim_kind, p_value numeric, p_statement text, p_proof text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare o orders; c uuid; hrs numeric;
begin
  select * into o from orders where id = p_order and business_id = my_business_id();
  if o.id is null then raise exception 'Order not found.'; end if;
  if o.status not in ('delivered','returned') then raise exception 'Claims are for delivered or returned orders.'; end if;
  hrs := case when p_kind = 'missing' then setting_num('missing_item_hours') else setting_num('claim_hours') end;
  if o.status = 'delivered' and o.delivered_at + make_interval(hours => hrs::int) < now() then
    raise exception 'Too late: % claims must be made within % hours of delivery.', p_kind, hrs;
  end if;
  if coalesce(p_value, 0) <= 0 then raise exception 'Enter the goods value you are claiming.'; end if;
  if length(trim(coalesce(p_statement,''))) < 10 then raise exception 'Describe what happened.'; end if;
  if exists (select 1 from claims where order_id = o.id and status = 'open') then raise exception 'There is already an open claim on this order.'; end if;
  insert into claims (order_id, business_id, kind, claimed_value, statement, proof_path, opened_by)
  values (o.id, o.business_id, p_kind, least(p_value, setting_num('claim_limit')), p_statement, p_proof, auth.uid()) returning id into c;
  perform move_order(o.id, 'claim_open', 'Claim opened: ' || p_kind);
  perform raise_issue('claim', o.id, initcap(p_kind::text) || ' claim for ' || o.ref || case when p_value > setting_num('claim_limit') then ' (capped at the ₦100,000 limit)' else '' end);
  perform notify_role('operations', 'claim', 'New claim: ' || o.ref, initcap(p_kind::text), '/disputes');
  return c;
end $$;

-- Operations decides from the photos and timeline. Rider-caused: Ọ̀nà refunds (paid by the super admin).
-- Store-caused: the business's responsibility. Unclear: Operations' decision, logged.
create or replace function decide_claim(p_claim uuid, p_cause claim_cause, p_approve boolean, p_decision text) returns void
language plpgsql security definer set search_path = public as $$
declare c claims; o orders;
begin
  if not has_role('operations') then raise exception 'Only Operations decides claims.'; end if;
  if length(trim(coalesce(p_decision,''))) < 10 then raise exception 'Explain the decision (at least 10 characters).'; end if;
  select * into c from claims where id = p_claim and status = 'open' for update;
  if c.id is null then raise exception 'Claim not found or already decided.'; end if;
  if p_cause = 'store' and p_approve then raise exception 'Store-caused damage is the business''s responsibility; it cannot be approved for refund.'; end if;
  update claims set cause = p_cause, status = case when p_approve then 'approved' else 'rejected' end::claim_status,
         decision = p_decision, payout = case when p_approve then claimed_value end, decided_by = auth.uid(), decided_at = now()
  where id = c.id;
  select * into o from orders where id = c.order_id;
  perform move_order(o.id, case when o.delivered_at is not null then 'delivered' else 'returned' end::order_status, 'Claim decided: ' || p_decision);
  update issues set status = 'resolved', resolution = p_decision, resolved_by = auth.uid(), resolved_at = now() where order_id = o.id and kind = 'claim' and status = 'open';
  perform notify_business(c.business_id, 'claim_decided', 'Claim on ' || o.ref || ': ' || case when p_approve then 'approved' else 'not approved' end, p_decision, '/feedback');
  if p_approve then perform notify_role('super_admin', 'claim_payout', 'Refund to pay: ' || o.ref, 'Approved rider-caused claim.', '/'); end if;
end $$;

create or replace function mark_claim_paid(p_claim uuid, p_reference text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('super_admin') then raise exception 'Only the super admin records refunds.'; end if;
  if length(trim(coalesce(p_reference,''))) < 4 then raise exception 'Enter the transfer reference.'; end if;
  update claims set status = 'paid', refund_reference = trim(p_reference) where id = p_claim and status = 'approved';
  if not found then raise exception 'Only approved claims can be marked paid.'; end if;
  perform notify_business((select business_id from claims where id = p_claim), 'claim_paid', 'Refund sent', 'Reference ' || trim(p_reference), '/feedback');
end $$;

create or replace function rate_order(p_order uuid, p_rating int, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = p_order and customer_id = auth.uid();
  if o.id is null or o.status not in ('delivered','claim_open') then raise exception 'You can rate a delivered order.'; end if;
  insert into order_feedback (order_id, customer_id, rating, comment) values (o.id, auth.uid(), p_rating, nullif(trim(coalesce(p_comment,'')),''))
  on conflict (order_id) do update set rating = excluded.rating, comment = excluded.comment;
  perform notify_business(o.business_id, 'rating', o.ref || ' rated ' || p_rating || '/5', p_comment, '/feedback');
end $$;

create or replace function customer_report(p_order uuid, p_detail text) returns void
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = p_order and customer_id = auth.uid();
  if o.id is null then raise exception 'Order not found.'; end if;
  if length(trim(coalesce(p_detail,''))) < 10 then raise exception 'Describe the problem (at least 10 characters).'; end if;
  perform raise_issue('complaint', o.id, 'Customer: ' || p_detail);
  perform notify_business(o.business_id, 'complaint', 'Customer reported a problem on ' || o.ref, p_detail, '/feedback');
  perform notify_role('operations', 'complaint', 'Customer complaint ' || o.ref, p_detail, '/disputes');
end $$;

create or replace function resolve_issue(p_issue bigint, p_resolution text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('operations','super_admin') then raise exception 'Only Ọ̀nà staff can resolve issues.'; end if;
  if length(trim(coalesce(p_resolution,''))) < 3 then raise exception 'Say how it was resolved.'; end if;
  update issues set status = 'resolved', resolution = p_resolution, resolved_by = auth.uid(), resolved_at = now() where id = p_issue and status = 'open';
end $$;

create or replace function prompt_business(p_business uuid, p_message text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('super_admin') then raise exception 'Only the super admin prompts businesses.'; end if;
  if length(trim(coalesce(p_message,''))) < 5 then raise exception 'Write the message.'; end if;
  perform notify_business(p_business, 'prompt', 'Message from Ọ̀nà', p_message, '/');
  perform audit('business', p_business::text, 'prompted', p_message, null, null);
end $$;

create or replace function record_payout(p_rider uuid, p_period text, p_amount numeric, p_reference text, p_paid boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not has_role('operations','super_admin') then raise exception 'Only Ọ̀nà staff record rider pay.'; end if;
  insert into rider_payouts (rider_id, period, trips, amount, reference, status, created_by)
  values (p_rider, p_period, (select count(*) from routes where rider_id = p_rider and status = 'done'), p_amount, p_reference,
          case when p_paid then 'paid' else 'owed' end, auth.uid());
end $$;

-- ---------------------------------------------------------------- dashboards
create or replace function revenue_between(p_from timestamptz, p_to timestamptz) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(p.amount), 0) from payments p where p.status = 'confirmed' and p.decided_at >= p_from and p.decided_at < p_to
$$;

-- Super admin: revenue means delivery fees and waiting charges confirmed. Never goods value.
create or replace function admin_overview() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when has_role('super_admin') then jsonb_build_object(
    'revenue_today', revenue_between(date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos', now() + interval '1 second'),
    'revenue_7d', revenue_between(now() - interval '7 days', now() + interval '1 second'),
    'revenue_30d', revenue_between(now() - interval '30 days', now() + interval '1 second'),
    'revenue_by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'amount', revenue_between(d, d + interval '1 day')) order by d), '[]'::jsonb)
                       from generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') d),
    'orders_by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from orders group by status) s),
    'delivered_30d', (select count(*) from orders where delivered_at > now() - interval '30 days'),
    'on_time_30d', (select count(*) from orders where delivered_at > now() - interval '30 days' and delivered_at <= window_end),
    'late_traffic_30d', (select count(*) from orders where delivered_at > now() - interval '30 days' and delivered_at > window_end and late_reason ilike '%traffic%'),
    'failed_30d', (select count(*) from order_events where to_status in ('failed_pickup','failed_delivery') and at > now() - interval '30 days'),
    'receipts_waiting', (select count(*) from payments where status = 'pending'),
    'oldest_receipt_minutes', (select floor(extract(epoch from now() - min(created_at)) / 60) from payments where status = 'pending'),
    'open_issues', (select count(*) from issues where status = 'open'),
    'claims_to_pay', (select count(*) from claims where status = 'approved'),
    'counts', platform_counts(),
    'businesses', (select coalesce(jsonb_agg(x order by (x->>'orders_30d')::int desc), '[]'::jsonb) from (
       select jsonb_build_object('id', b.id, 'name', b.name, 'zone', b.zone, 'active', b.active,
         'orders_30d', (select count(*) from orders o where o.business_id = b.id and o.created_at > now() - interval '30 days'),
         'revenue_30d', (select coalesce(sum(p.amount),0) from payments p where p.business_id = b.id and p.status = 'confirmed' and p.decided_at > now() - interval '30 days'),
         'open_issues', (select count(*) from issues i where i.business_id = b.id and i.status = 'open'),
         'delivered_30d', (select count(*) from orders o where o.business_id = b.id and o.delivered_at > now() - interval '30 days'),
         'on_time_30d', (select count(*) from orders o where o.business_id = b.id and o.delivered_at > now() - interval '30 days' and o.delivered_at <= o.window_end)) x
       from businesses b) s)
  ) end
$$;

create or replace function ops_overview() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when has_role('operations') then jsonb_build_object(
    'to_dispatch', (select count(*) from orders where status = 'ready_for_pickup'),
    'routes_active', (select count(*) from routes where status = 'active'),
    'routes_offered', (select count(*) from routes where status = 'offered'),
    'on_the_road', (select count(*) from orders where status in ('out_for_delivery','rider_changing')),
    'at_shops', (select count(*) from route_stops s join routes r on r.id = s.route_id where r.status = 'active' and s.kind = 'pickup' and s.arrived_at is not null and s.done_at is null),
    'late', (select count(*) from orders where status in ('rider_assigned','rider_at_shop','out_for_delivery','rider_changing') and coalesce(eta, now()) > window_end),
    'failed_open', (select count(*) from orders where status in ('failed_pickup','failed_delivery')),
    'codes_locked', (select count(*) from codes where locked_at is not null and used_at is null),
    'claims_open', (select count(*) from claims where status = 'open'),
    'issues_open', (select count(*) from issues where status = 'open'),
    'delivered_today', (select count(*) from orders where delivered_at >= date_trunc('day', now())),
    'counts', platform_counts(),
    'licences_expiring', (select count(*) from riders where licence_expiry between current_date and current_date + 30)
  ) end
$$;

create or replace function owner_overview() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when my_business_id() is not null then jsonb_build_object(
    'orders_by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from orders where business_id = my_business_id() group by status) s),
    'orders_30d', (select count(*) from orders where business_id = my_business_id() and created_at > now() - interval '30 days'),
    'delivered_30d', (select count(*) from orders where business_id = my_business_id() and delivered_at > now() - interval '30 days'),
    'on_time_30d', (select count(*) from orders where business_id = my_business_id() and delivered_at > now() - interval '30 days' and delivered_at <= window_end),
    'late_traffic_30d', (select count(*) from orders where business_id = my_business_id() and delivered_at > now() - interval '30 days' and delivered_at > window_end and late_reason ilike '%traffic%'),
    'failed_30d', (select count(*) from order_events e join orders o on o.id = e.order_id where o.business_id = my_business_id() and e.to_status in ('failed_pickup','failed_delivery') and e.at > now() - interval '30 days'),
    'fees_30d', (select coalesce(sum(amount), 0) from payments where business_id = my_business_id() and status = 'confirmed' and decided_at > now() - interval '30 days'),
    'balance', (select coalesce(sum(amount), 0) from business_adjustments where business_id = my_business_id() and request_id is null),
    'low_stock', (select count(*) from products where business_id = my_business_id() and active and on_hand - reserved <= low_stock_at),
    'stock_value', (select coalesce(sum(on_hand * price), 0) from products where business_id = my_business_id() and active),
    'rating', (select round(avg(f.rating), 1) from order_feedback f join orders o on o.id = f.order_id where o.business_id = my_business_id()),
    'ratings', (select count(*) from order_feedback f join orders o on o.id = f.order_id where o.business_id = my_business_id()),
    'packing_issues', (select count(*) from claims where business_id = my_business_id() and cause = 'store'),
    'awaiting_payment', (select count(*) from dispatch_requests where business_id = my_business_id() and status in ('awaiting_payment','payment_check')),
    'customers', (select count(*) from business_customers where business_id = my_business_id()),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date,
                 'created', (select count(*) from orders o where o.business_id = my_business_id() and o.created_at >= d and o.created_at < d + interval '1 day'),
                 'delivered', (select count(*) from orders o where o.business_id = my_business_id() and o.delivered_at >= d and o.delivered_at < d + interval '1 day')) order by d), '[]'::jsonb)
               from generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') d)
  ) end
$$;

-- Rider performance and pay for Operations and the super admin.
create or replace function rider_stats() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when has_role('operations','super_admin') then coalesce(jsonb_agg(jsonb_build_object(
    'rider_id', p.id, 'name', p.full_name, 'phone', p.phone, 'availability', r.availability, 'zone', r.zone, 'licence_expiry', r.licence_expiry,
    'plate', v.plate, 'vehicle', v.type,
    'routes_done', (select count(*) from routes x where x.rider_id = p.id and x.status = 'done'),
    'delivered', (select count(*) from orders o join order_events e on e.order_id = o.id and e.to_status = 'delivered' where e.by_user = p.id),
    'failed', (select count(*) from order_events e where e.by_user = p.id and e.to_status in ('failed_delivery','failed_pickup')),
    'rider_claims', (select count(*) from claims c join orders o on o.id = c.order_id where c.cause = 'rider' and o.rider_id = p.id),
    'pay_owed', (select coalesce(sum(amount),0) from rider_payouts y where y.rider_id = p.id and y.status = 'owed'),
    'pay_paid', (select coalesce(sum(amount),0) from rider_payouts y where y.rider_id = p.id and y.status = 'paid')
  ) order by p.full_name), '[]'::jsonb) end
  from riders r join profiles p on p.id = r.profile_id left join vehicles v on v.id = r.vehicle_id where p.status = 'active'
$$;

-- ---------------------------------------------------------------- RLS
alter table dispatch_requests enable row level security;
alter table payments enable row level security;
alter table business_adjustments enable row level security;
alter table routes enable row level security;
alter table route_stops enable row level security;
alter table codes enable row level security;
alter table rider_locations enable row level security;
alter table claims enable row level security;
alter table issues enable row level security;
alter table order_feedback enable row level security;
alter table rider_payouts enable row level security;

-- money: super admin and the owning business only
create policy requests_admin on dispatch_requests for select using (has_role('super_admin'));
create policy requests_own on dispatch_requests for select using (business_id = my_business_id());
create policy payments_admin on payments for select using (has_role('super_admin'));
create policy payments_own on payments for select using (business_id = my_business_id());
create policy adjustments_admin on business_adjustments for select using (has_role('super_admin'));
create policy adjustments_own on business_adjustments for select using (business_id = my_business_id());

-- trips: Operations and super admin; riders see their own routes (stops come through rider_route())
create policy routes_staff on routes for select using (has_role('operations','super_admin'));
create policy routes_own on routes for select using (rider_id = auth.uid());
create policy stops_staff on route_stops for select using (has_role('operations','super_admin'));
-- codes: nobody reads the table; code_value() decides who sees which code
create policy locations_staff on rider_locations for select using (has_role('operations','super_admin'));

create policy claims_staff on claims for select using (has_role('operations','super_admin'));
create policy claims_own on claims for select using (business_id = my_business_id());
create policy issues_staff on issues for select using (has_role('operations','super_admin'));
create policy issues_own on issues for select using (business_id = my_business_id());
create policy feedback_staff on order_feedback for select using (has_role('operations','super_admin'));
create policy feedback_business on order_feedback for select using (exists (select 1 from orders o where o.id = order_id and o.business_id = my_business_id()));
create policy feedback_own on order_feedback for select using (customer_id = auth.uid());
create policy payouts_staff on rider_payouts for select using (has_role('operations','super_admin'));

-- ---------------------------------------------------------------- grants
revoke execute on function raise_issue(issue_kind,uuid,text,uuid), code_value(uuid), make_code(code_kind,uuid,uuid), check_code(uuid,text),
  release_to_dispatch(uuid), expire_request(uuid), complete_delivery(uuid,text,text), finish_route_if_done(uuid),
  cancel_order_internal(uuid,text), revenue_between(timestamptz,timestamptz), purge_old_locations()
  from public, anon, authenticated;
revoke execute on function code_message(text), my_rider_route_id(), request_dispatch(uuid[]), submit_payment(uuid,text,text,numeric),
  review_payment(uuid,boolean,text), cancel_request(uuid), expire_overdue_requests(), vehicle_rank(vehicle_type),
  available_riders(vehicle_type,int), suggest_routes(), create_route(uuid,uuid[],boolean,text), respond_route(uuid,boolean,text),
  arrive_stop(uuid,numeric,numeric), owner_more_time(uuid), waiting_charge_for(numeric), confirm_pickup(uuid,text,int,text),
  fail_pickup(uuid,text), resolve_failed_pickup(uuid,text,text), deliver_order(uuid,text,text), fail_delivery(uuid,text),
  resolve_failed_delivery(uuid,text,text), override_delivery(uuid,text), change_rider(uuid,uuid,text), accept_handover(uuid,text,text),
  report_delay(uuid,timestamptz,text), report_problem(text), ping_location(numeric,numeric), rider_route(), rider_history(),
  order_tracking(uuid), owner_pickups(), live_trips(), open_claim(uuid,claim_kind,numeric,text,text),
  decide_claim(uuid,claim_cause,boolean,text), mark_claim_paid(uuid,text), rate_order(uuid,int,text), customer_report(uuid,text),
  resolve_issue(bigint,text), prompt_business(uuid,text), record_payout(uuid,text,numeric,text,boolean),
  admin_overview(), ops_overview(), owner_overview(), rider_stats()
  from public, anon;
grant execute on function code_message(text), my_rider_route_id(), request_dispatch(uuid[]), submit_payment(uuid,text,text,numeric),
  review_payment(uuid,boolean,text), cancel_request(uuid), expire_overdue_requests(), vehicle_rank(vehicle_type),
  available_riders(vehicle_type,int), suggest_routes(), create_route(uuid,uuid[],boolean,text), respond_route(uuid,boolean,text),
  arrive_stop(uuid,numeric,numeric), owner_more_time(uuid), waiting_charge_for(numeric), confirm_pickup(uuid,text,int,text),
  fail_pickup(uuid,text), resolve_failed_pickup(uuid,text,text), deliver_order(uuid,text,text), fail_delivery(uuid,text),
  resolve_failed_delivery(uuid,text,text), override_delivery(uuid,text), change_rider(uuid,uuid,text), accept_handover(uuid,text,text),
  report_delay(uuid,timestamptz,text), report_problem(text), ping_location(numeric,numeric), rider_route(), rider_history(),
  order_tracking(uuid), owner_pickups(), live_trips(), open_claim(uuid,claim_kind,numeric,text,text),
  decide_claim(uuid,claim_cause,boolean,text), mark_claim_paid(uuid,text), rate_order(uuid,int,text), customer_report(uuid,text),
  resolve_issue(bigint,text), prompt_business(uuid,text), record_payout(uuid,text,numeric,text,boolean),
  admin_overview(), ops_overview(), owner_overview(), rider_stats()
  to authenticated;
