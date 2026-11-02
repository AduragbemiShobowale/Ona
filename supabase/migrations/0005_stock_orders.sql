-- Ọ̀nà phase 2: each business's stock, customers and addresses, orders and the transitions table.
-- Privacy (spec section 9):
--   * goods prices live only in products and order_items, readable by the owning business and the order's customer
--   * the super admin never selects orders directly (no address, no goods); it uses admin_orders()
--   * riders never select orders; rider_route() returns only what an open job needs
--   * a business reaches customers only through send_order(), which never says whether the e-mail had an account

-- ---------------------------------------------------------------- types
create type size_class as enum ('small','medium','large','bulky');
create type order_status as enum (
  'awaiting_address','received','waiting_restock','packed','awaiting_payment','payment_check','payment_rejected',
  'ready_for_pickup','rider_assigned','rider_at_shop','failed_pickup','out_for_delivery','rider_changing',
  'delivered','failed_delivery','returned','cancelled','claim_open');
create type movement_kind as enum ('stock_in','adjust','reserve','release','dispatch');

-- ---------------------------------------------------------------- stock (Verity-style ledger, one per business)
create table products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  sku text not null check (length(trim(sku)) between 1 and 40),
  name text not null check (length(trim(name)) between 2 and 120),
  size_class size_class not null default 'small',
  price numeric(12,2) not null default 0 check (price >= 0),   -- goods value: owner and own customers only
  on_hand int not null default 0 check (on_hand >= 0),
  reserved int not null default 0 check (reserved >= 0),
  low_stock_at int not null default 3 check (low_stock_at >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_id, sku),
  check (reserved <= on_hand)
);

create table stock_movements (
  id bigserial primary key,
  business_id uuid not null references businesses(id),
  product_id uuid not null references products(id),
  kind movement_kind not null,
  qty int not null,            -- signed change to on_hand (stock_in, adjust, dispatch) or to reserved (reserve, release)
  reason text,
  order_id uuid,
  by_user uuid,
  at timestamptz not null default now()
);
create index stock_movements_product_idx on stock_movements (product_id, at desc);

-- ---------------------------------------------------------------- customers
create table customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  label text not null default 'Home',
  address text not null check (length(trim(address)) >= 5),
  landmark text,
  zone text,
  lat numeric(9,6), lng numeric(9,6),
  phone text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

-- A business's link to a customer exists only because it sent them an order.
create table business_customers (
  business_id uuid not null references businesses(id),
  email text not null,
  customer_id uuid references profiles(id),
  display_name text,
  first_order_at timestamptz not null default now(),
  last_order_at timestamptz not null default now(),
  orders_count int not null default 0,
  primary key (business_id, email)
);

-- ---------------------------------------------------------------- orders
create sequence order_no_seq start 1001;
create table orders (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default ('ON-' || nextval('order_no_seq')),
  business_id uuid not null references businesses(id),
  customer_email text not null,
  customer_id uuid references profiles(id),
  customer_name text,
  status order_status not null default 'awaiting_address',
  window_start timestamptz not null,
  window_end timestamptz not null,
  zone text,
  drop_address text, drop_landmark text, drop_phone text,
  drop_lat numeric(9,6), drop_lng numeric(9,6),
  distance_km numeric(6,2),
  bags int not null default 1 check (bags between 1 and 50),
  vehicle_type vehicle_type not null default 'bike',
  note text,
  request_id uuid,            -- dispatch request (phase 3)
  route_id uuid,              -- route (phase 4)
  rider_id uuid references profiles(id),
  eta timestamptz,
  late_reason text,
  delivered_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (window_end > window_start)
);
create index orders_business_idx on orders (business_id, created_at desc);
create index orders_status_idx on orders (status);
create index orders_customer_idx on orders (customer_id);
create index orders_email_idx on orders (lower(customer_email));
create index orders_slot_idx on orders (zone, window_start);

create table order_items (
  id bigserial primary key,
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid not null references products(id),
  name text not null,
  qty int not null check (qty > 0),
  unit_price numeric(12,2) not null default 0
);
create index order_items_order_idx on order_items (order_id);

-- Delivery fee and waiting charge: super admin and the owning business only (Operations sees status, not money).
create table order_charges (
  order_id uuid primary key references orders(id) on delete cascade,
  business_id uuid not null references businesses(id),
  fee numeric(12,2) not null default 0,
  waiting_charge numeric(12,2) not null default 0
);

create table order_events (
  id bigserial primary key,
  order_id uuid not null references orders(id) on delete cascade,
  from_status order_status,
  to_status order_status not null,
  reason text,
  by_user uuid,
  by_role app_role,
  at timestamptz not null default now()
);
create index order_events_order_idx on order_events (order_id, at);

-- The only allowed status moves. Anything else is refused by move_order().
create table order_transitions (
  from_status order_status not null,
  to_status order_status not null,
  primary key (from_status, to_status)
);
insert into order_transitions values
  ('awaiting_address','received'), ('awaiting_address','cancelled'),
  ('received','packed'), ('received','waiting_restock'), ('received','cancelled'),
  ('waiting_restock','received'), ('waiting_restock','cancelled'),
  ('packed','awaiting_payment'), ('packed','received'), ('packed','cancelled'),
  ('awaiting_payment','payment_check'), ('awaiting_payment','packed'), ('awaiting_payment','cancelled'),
  ('payment_check','ready_for_pickup'), ('payment_check','payment_rejected'),
  ('payment_rejected','payment_check'), ('payment_rejected','packed'), ('payment_rejected','cancelled'),
  ('ready_for_pickup','rider_assigned'), ('ready_for_pickup','cancelled'),
  ('rider_assigned','rider_at_shop'), ('rider_assigned','ready_for_pickup'), ('rider_assigned','cancelled'),
  ('rider_at_shop','out_for_delivery'), ('rider_at_shop','failed_pickup'),
  ('failed_pickup','packed'), ('failed_pickup','ready_for_pickup'),
  ('out_for_delivery','delivered'), ('out_for_delivery','failed_delivery'), ('out_for_delivery','rider_changing'),
  ('rider_changing','out_for_delivery'),
  ('failed_delivery','returned'), ('failed_delivery','ready_for_pickup'),
  ('delivered','claim_open'), ('claim_open','delivered'), ('returned','claim_open'), ('claim_open','returned');

-- ---------------------------------------------------------------- notifications
create or replace function notify(p_user uuid, p_event text, p_title text, p_body text, p_link text, p_email boolean default false)
returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, event, title, body, link, send_email)
  select p_user, p_event, p_title, p_body, p_link, p_email where p_user is not null
$$;

create or replace function notify_business(p_business uuid, p_event text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, event, title, body, link)
  select id, p_event, p_title, p_body, p_link from profiles where business_id = p_business and role = 'owner' and status = 'active'
$$;

create or replace function notify_role(p_role app_role, p_event text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into notifications (user_id, event, title, body, link)
  select id, p_event, p_title, p_body, p_link from profiles where role = p_role and status = 'active'
$$;

-- ---------------------------------------------------------------- the one way to change an order's status
create or replace function move_order(p_order uuid, p_to order_status, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare cur order_status;
begin
  select status into cur from orders where id = p_order for update;
  if cur is null then raise exception 'Order not found.'; end if;
  if cur = p_to then return; end if;
  if not exists (select 1 from order_transitions where from_status = cur and to_status = p_to) then
    raise exception 'An order cannot go from % to %.', replace(cur::text,'_',' '), replace(p_to::text,'_',' ');
  end if;
  perform set_config('ona.moving', 'yes', true);
  update orders set status = p_to, delivered_at = case when p_to = 'delivered' then now() else delivered_at end where id = p_order;
  perform set_config('ona.moving', '', true);
  insert into order_events (order_id, from_status, to_status, reason, by_user, by_role)
  values (p_order, cur, p_to, p_reason, auth.uid(), my_role());
end $$;

-- Refuse a status change that did not come through move_order().
create or replace function guard_order_status() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status and coalesce(current_setting('ona.moving', true), '') <> 'yes' then
    raise exception 'Order status can only change through the allowed transitions.';
  end if;
  return new;
end $$;
create trigger orders_status_guard before update on orders for each row execute function guard_order_status();

-- ---------------------------------------------------------------- slots and fees
-- The windows offered on a date, from settings: [{start, end, label}]
create or replace function slot_windows(p_date date) returns table (w_start timestamptz, w_end timestamptz, label text)
language sql stable security definer set search_path = public as $$
  select (p_date::text || ' ' || split_part(s, '-', 1) || ':00 Africa/Lagos')::timestamptz,
         (p_date::text || ' ' || split_part(s, '-', 2) || ':00 Africa/Lagos')::timestamptz,
         s
  from jsonb_array_elements_text(setting('slots') -> (case when extract(isodow from p_date) = 7 then 'sun' else 'mon_sat' end)) s
$$;

-- Windows for a zone and date with how many places are left.
create or replace function slots_for(p_zone text, p_date date) returns table (w_start timestamptz, w_end timestamptz, label text, used int, capacity int, open boolean)
language sql stable security definer set search_path = public as $$
  select w.w_start, w.w_end, w.label,
         (select count(*)::int from orders o where o.zone is not distinct from p_zone and o.window_start = w.w_start and o.status <> 'cancelled'),
         setting_num('slot_capacity')::int,
         w.w_start - make_interval(mins => setting_num('payment_cutoff_minutes')::int) > now()
           and (select count(*) from orders o where o.zone is not distinct from p_zone and o.window_start = w.w_start and o.status <> 'cancelled') < setting_num('slot_capacity')
  from slot_windows(p_date) w
  where auth.uid() is not null
  order by 1
$$;

create or replace function distance_km(a_lat numeric, a_lng numeric, b_lat numeric, b_lng numeric) returns numeric
language sql immutable as $$
  select case when a_lat is null or b_lat is null then null else round((6371 * 2 * asin(sqrt(
    power(sin(radians(b_lat - a_lat) / 2), 2) + cos(radians(a_lat)) * cos(radians(b_lat)) * power(sin(radians(b_lng - a_lng) / 2), 2))))::numeric, 2) end
$$;

create or replace function fee_for(p_vehicle vehicle_type, p_km numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select (setting('fees') -> p_vehicle::text ->> (
    case when coalesce(p_km, 0) <= (setting('band_limits_km')->>0)::numeric then 0
         when p_km <= (setting('band_limits_km')->>1)::numeric then 1
         when p_km <= (setting('band_limits_km')->>2)::numeric then 2 else 3 end))::numeric
$$;

-- Vehicle suggested from the biggest item and the number of bags.
create or replace function suggest_vehicle(p_max size_class, p_bags int) returns vehicle_type
language sql immutable as $$
  select case when p_max = 'bulky' or p_bags > 12 then 'truck'
              when p_max = 'large' or p_bags > 6 then 'van'
              when p_max = 'medium' or p_bags > 3 then 'car'
              else 'bike' end::vehicle_type
$$;

-- ---------------------------------------------------------------- stock functions (owner)
create or replace function save_product(p_id uuid, p_sku text, p_name text, p_size size_class, p_price numeric, p_low int, p_active boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare b uuid := my_business_id(); v uuid;
begin
  if b is null then raise exception 'Only a business owner can manage stock.'; end if;
  if p_id is null then
    insert into products (business_id, sku, name, size_class, price, low_stock_at)
    values (b, upper(trim(p_sku)), trim(p_name), coalesce(p_size,'small'), coalesce(p_price,0), coalesce(p_low,3)) returning id into v;
  else
    update products set sku = upper(trim(p_sku)), name = trim(p_name), size_class = coalesce(p_size, size_class),
           price = coalesce(p_price, price), low_stock_at = coalesce(p_low, low_stock_at), active = coalesce(p_active, active)
    where id = p_id and business_id = b returning id into v;
    if v is null then raise exception 'Product not found.'; end if;
  end if;
  return v;
exception when unique_violation then raise exception 'You already have a product with SKU %.', upper(trim(p_sku));
end $$;

-- Stock in (positive) or adjustment (either sign, needs a reason).
create or replace function move_stock(p_product uuid, p_kind movement_kind, p_qty int, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare b uuid := my_business_id(); p products;
begin
  if b is null then raise exception 'Only a business owner can change stock.'; end if;
  select * into p from products where id = p_product and business_id = b for update;
  if p.id is null then raise exception 'Product not found.'; end if;
  if p_kind = 'stock_in' and coalesce(p_qty,0) <= 0 then raise exception 'Enter how many came in.'; end if;
  if p_kind = 'adjust' and length(trim(coalesce(p_reason,''))) < 3 then raise exception 'Say why you are adjusting the stock.'; end if;
  if p_kind not in ('stock_in','adjust') then raise exception 'Use stock in or adjustment.'; end if;
  if p.on_hand + p_qty < p.reserved then raise exception 'That would leave less than the % already reserved for orders.', p.reserved; end if;
  update products set on_hand = on_hand + p_qty where id = p.id;
  insert into stock_movements (business_id, product_id, kind, qty, reason, by_user) values (b, p.id, p_kind, p_qty, p_reason, auth.uid());
end $$;

-- ---------------------------------------------------------------- send_order: the only way a business reaches a customer
-- p_items: [{"product_id": "...", "qty": 2}]   p_address (optional): {"address","landmark","phone","lat","lng"}
-- Returns the order number only. Whether the e-mail already had an account is never revealed.
create or replace function send_order(p_email text, p_customer_name text, p_items jsonb, p_window_start timestamptz,
                                      p_zone text, p_address jsonb default null, p_bags int default null,
                                      p_vehicle vehicle_type default null, p_distance_km numeric default null, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  b uuid := my_business_id(); biz businesses; e text := lower(trim(coalesce(p_email,'')));
  o uuid; r text; it jsonb; p products; maxsize size_class := 'small'; nitems int := 0; w record;
  cust uuid; v_km numeric; v_veh vehicle_type; v_bags int; used int;
begin
  if b is null then raise exception 'Only a business owner can send orders.'; end if;
  select * into biz from businesses where id = b;
  if not biz.active then raise exception 'Your business is not active. Contact Ọ̀nà.'; end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then raise exception 'Enter the customer''s e-mail address.'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Add at least one item.'; end if;
  if length(trim(coalesce(p_zone,''))) < 2 then raise exception 'Choose the delivery zone.'; end if;

  -- the window must be one of Ọ̀nà's slots, open, and not full
  select * into w from slot_windows((p_window_start at time zone 'Africa/Lagos')::date) s where s.w_start = p_window_start;
  if w.w_start is null then raise exception 'Choose one of the delivery windows.'; end if;
  if w.w_start - make_interval(mins => setting_num('payment_cutoff_minutes')::int) <= now() then
    raise exception 'That window is too soon: the fee must be paid an hour before it starts. Pick a later one.';
  end if;
  perform pg_advisory_xact_lock(hashtext(coalesce(p_zone,'') || p_window_start::text));
  select count(*) into used from orders where zone = trim(p_zone) and window_start = p_window_start and status <> 'cancelled';
  if used >= setting_num('slot_capacity') then raise exception 'That window is full for %. Pick another.', trim(p_zone); end if;

  select id into cust from profiles where lower(email) = e and role = 'customer' and status = 'active'
     and exists (select 1 from auth.users u where u.id = profiles.id and u.email_confirmed_at is not null);

  insert into orders (business_id, customer_email, customer_id, customer_name, status, window_start, window_end, zone, note, created_by,
                      drop_address, drop_landmark, drop_phone, drop_lat, drop_lng)
  values (b, e, cust, nullif(trim(coalesce(p_customer_name,'')),''), 'awaiting_address', w.w_start, w.w_end, trim(p_zone), p_note, auth.uid(),
          nullif(trim(coalesce(p_address->>'address','')),''), p_address->>'landmark', p_address->>'phone',
          (p_address->>'lat')::numeric, (p_address->>'lng')::numeric)
  returning id, ref into o, r;
  insert into order_events (order_id, to_status, reason, by_user, by_role) values (o, 'awaiting_address', 'Order created', auth.uid(), 'owner');

  for it in select * from jsonb_array_elements(p_items) loop
    if coalesce((it->>'qty')::int, 0) <= 0 then raise exception 'Each item needs a quantity.'; end if;
    select * into p from products where id = (it->>'product_id')::uuid and business_id = b and active for update;
    if p.id is null then raise exception 'One of the items is not in your stock.'; end if;
    if p.on_hand - p.reserved < (it->>'qty')::int then
      raise exception 'Only % of % available.', p.on_hand - p.reserved, p.name;
    end if;
    update products set reserved = reserved + (it->>'qty')::int where id = p.id;
    insert into stock_movements (business_id, product_id, kind, qty, reason, order_id, by_user)
    values (b, p.id, 'reserve', (it->>'qty')::int, 'Order ' || r, o, auth.uid());
    insert into order_items (order_id, product_id, name, qty, unit_price) values (o, p.id, p.name, (it->>'qty')::int, p.price);
    if p.size_class > maxsize then maxsize := p.size_class; end if;
    nitems := nitems + (it->>'qty')::int;
  end loop;

  v_bags := coalesce(p_bags, greatest(1, ceil(nitems / 3.0)::int));
  v_veh := coalesce(p_vehicle, suggest_vehicle(maxsize, v_bags));
  v_km := coalesce(distance_km(biz.pickup_lat, biz.pickup_lng, (p_address->>'lat')::numeric, (p_address->>'lng')::numeric), p_distance_km, 0);
  update orders set bags = v_bags, vehicle_type = v_veh, distance_km = v_km where id = o;
  insert into order_charges (order_id, business_id, fee) values (o, b, fee_for(v_veh, v_km));

  insert into business_customers (business_id, email, customer_id, display_name, orders_count)
  values (b, e, cust, nullif(trim(coalesce(p_customer_name,'')),''), 1)
  on conflict (business_id, email) do update set last_order_at = now(), orders_count = business_customers.orders_count + 1,
    customer_id = coalesce(excluded.customer_id, business_customers.customer_id),
    display_name = coalesce(excluded.display_name, business_customers.display_name);

  if (select drop_address from orders where id = o) is not null then
    perform move_order(o, 'received', 'Address given by the business');
  end if;
  perform notify(cust, 'order_sent', biz.name || ' sent you an order', 'Order ' || r || '. Open it to see the delivery window' ||
                 case when (select drop_address from orders where id = o) is null then ' and choose your address.' else '.' end, '/orders/' || o, true);
  return r;
end $$;

-- A customer, once their e-mail is confirmed, picks up any orders sent to it before they had an account.
create or replace function link_my_orders() returns int
language plpgsql security definer set search_path = public as $$
declare e text; n int;
begin
  if not has_role('customer') then return 0; end if;
  select lower(u.email) into e from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null;
  if e is null then return 0; end if;
  update orders set customer_id = auth.uid() where customer_id is null and lower(customer_email) = e;
  get diagnostics n = row_count;
  update business_customers set customer_id = auth.uid() where customer_id is null and email = e;
  return n;
end $$;

-- ---------------------------------------------------------------- owner order actions
create or replace function owner_order(p_order uuid) returns orders
language sql stable security definer set search_path = public as $$
  select * from orders where id = p_order and business_id = my_business_id()
$$;

create or replace function release_stock(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare i record;
begin
  for i in select oi.product_id, oi.qty, o.business_id from order_items oi join orders o on o.id = oi.order_id where oi.order_id = p_order loop
    update products set reserved = greatest(0, reserved - i.qty) where id = i.product_id;
    insert into stock_movements (business_id, product_id, kind, qty, reason, order_id, by_user)
    values (i.business_id, i.product_id, 'release', -i.qty, p_reason, p_order, auth.uid());
  end loop;
end $$;

create or replace function set_order_address(p_order uuid, p_address jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare o orders; km numeric; biz businesses;
begin
  select * into o from orders where id = p_order for update;
  if o.id is null or not (o.business_id = my_business_id() or (o.customer_id = auth.uid() and has_role('customer'))) then
    raise exception 'Order not found.';
  end if;
  if o.status not in ('awaiting_address','received','waiting_restock','packed') then raise exception 'The address can no longer be changed.'; end if;
  if length(trim(coalesce(p_address->>'address',''))) < 5 then raise exception 'Enter the delivery address.'; end if;
  select * into biz from businesses where id = o.business_id;
  km := coalesce(distance_km(biz.pickup_lat, biz.pickup_lng, (p_address->>'lat')::numeric, (p_address->>'lng')::numeric), o.distance_km);
  update orders set drop_address = trim(p_address->>'address'), drop_landmark = p_address->>'landmark',
         drop_phone = coalesce(nullif(p_address->>'phone',''), drop_phone), drop_lat = (p_address->>'lat')::numeric,
         drop_lng = (p_address->>'lng')::numeric, zone = coalesce(nullif(p_address->>'zone',''), zone), distance_km = km
  where id = o.id;
  update order_charges set fee = fee_for(o.vehicle_type, km) where order_id = o.id;
  if o.status = 'awaiting_address' then
    perform move_order(o.id, 'received', case when has_role('customer') then 'Customer chose the address' else 'Business added the address' end);
    perform notify_business(o.business_id, 'address_chosen', 'Address chosen for ' || o.ref, 'You can pack it now.', '/orders?o=' || o.id);
  end if;
end $$;

create or replace function owner_set_status(p_order uuid, p_to order_status, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = p_order and business_id = my_business_id();
  if o.id is null then raise exception 'Order not found.'; end if;
  if p_to not in ('packed','received','waiting_restock','cancelled') then raise exception 'You cannot set that status.'; end if;
  if p_to = 'cancelled' then
    if o.status not in ('awaiting_address','received','waiting_restock','packed','awaiting_payment','payment_rejected','ready_for_pickup') then
      raise exception 'This order has already been collected; it cannot be cancelled.';
    end if;
    if length(trim(coalesce(p_reason,''))) < 3 then raise exception 'Say why you are cancelling.'; end if;
    perform cancel_order_internal(o.id, p_reason);
    return;
  end if;
  perform move_order(o.id, p_to, p_reason);
  if p_to = 'packed' then perform notify(o.customer_id, 'packed', 'Your order ' || o.ref || ' is packed', 'Ọ̀nà will collect it for your delivery window.', '/orders/' || o.id); end if;
end $$;

-- Cancel: release stock; if already paid, the fee becomes credit on the next payment (filled in by phase 3).
create or replace function cancel_order_internal(p_order uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = p_order;
  perform move_order(o.id, 'cancelled', p_reason);
  perform release_stock(o.id, 'Cancelled: ' || p_reason);
  perform notify(o.customer_id, 'cancelled', 'Order ' || o.ref || ' was cancelled', p_reason, '/orders/' || o.id);
end $$;

-- ---------------------------------------------------------------- customer
create or replace function save_address(p_id uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not has_role('customer') then raise exception 'Only customers keep addresses.'; end if;
  if length(trim(coalesce(p->>'address',''))) < 5 then raise exception 'Enter the address.'; end if;
  if coalesce((p->>'is_default')::boolean, false) then update customer_addresses set is_default = false where customer_id = auth.uid(); end if;
  if p_id is null then
    insert into customer_addresses (customer_id, label, address, landmark, zone, lat, lng, phone, is_default)
    values (auth.uid(), coalesce(nullif(trim(p->>'label'),''),'Home'), trim(p->>'address'), p->>'landmark', p->>'zone',
            (p->>'lat')::numeric, (p->>'lng')::numeric, p->>'phone',
            coalesce((p->>'is_default')::boolean, not exists (select 1 from customer_addresses where customer_id = auth.uid())))
    returning id into v;
  else
    update customer_addresses set label = coalesce(nullif(trim(p->>'label'),''), label), address = trim(p->>'address'),
           landmark = p->>'landmark', zone = p->>'zone', lat = (p->>'lat')::numeric, lng = (p->>'lng')::numeric,
           phone = p->>'phone', is_default = coalesce((p->>'is_default')::boolean, is_default)
    where id = p_id and customer_id = auth.uid() returning id into v;
    if v is null then raise exception 'Address not found.'; end if;
  end if;
  return v;
end $$;

create or replace function delete_address(p_id uuid) returns void
language sql security definer set search_path = public as $$
  delete from customer_addresses where id = p_id and customer_id = auth.uid()
$$;

-- ---------------------------------------------------------------- super admin: orders without addresses or goods
create or replace function admin_orders(p_status order_status default null, p_limit int default 200)
returns table (id uuid, ref text, business text, zone text, status order_status, window_start timestamptz, window_end timestamptz,
               vehicle_type vehicle_type, bags int, fee numeric, waiting_charge numeric, created_at timestamptz, delivered_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.id, o.ref, b.name, o.zone, o.status, o.window_start, o.window_end, o.vehicle_type, o.bags, c.fee, c.waiting_charge, o.created_at, o.delivered_at
  from orders o join businesses b on b.id = o.business_id left join order_charges c on c.order_id = o.id
  where has_role('super_admin') and (p_status is null or o.status = p_status)
  order by o.created_at desc limit p_limit
$$;

-- ---------------------------------------------------------------- RLS
alter table products enable row level security;
alter table stock_movements enable row level security;
alter table customer_addresses enable row level security;
alter table business_customers enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table order_charges enable row level security;
alter table order_events enable row level security;
alter table order_transitions enable row level security;

create policy products_own on products for select using (business_id = my_business_id());
create policy movements_own on stock_movements for select using (business_id = my_business_id());
create policy addresses_own on customer_addresses for select using (customer_id = auth.uid());
create policy bcust_own on business_customers for select using (business_id = my_business_id());

-- orders: the business, the customer, and Operations (routing and disputes). Not the super admin, not riders.
create policy orders_business on orders for select using (business_id = my_business_id());
create policy orders_customer on orders for select using (customer_id = auth.uid() and has_role('customer'));
create policy orders_ops on orders for select using (has_role('operations'));

create policy items_business on order_items for select using (exists (select 1 from orders o where o.id = order_id and o.business_id = my_business_id()));
create policy items_customer on order_items for select using (exists (select 1 from orders o where o.id = order_id and o.customer_id = auth.uid()));

create policy charges_business on order_charges for select using (business_id = my_business_id());
create policy charges_admin on order_charges for select using (has_role('super_admin'));

create policy events_visible on order_events for select using (
  has_role('super_admin') or exists (select 1 from orders o where o.id = order_id));
create policy transitions_read on order_transitions for select using (auth.uid() is not null);

-- ---------------------------------------------------------------- grants
revoke execute on function notify(uuid,text,text,text,text,boolean), notify_business(uuid,text,text,text,text),
  notify_role(app_role,text,text,text,text), move_order(uuid,order_status,text), guard_order_status(),
  release_stock(uuid,text), cancel_order_internal(uuid,text), slot_windows(date)
  from public, anon, authenticated;
revoke execute on function slots_for(text,date), distance_km(numeric,numeric,numeric,numeric), fee_for(vehicle_type,numeric),
  suggest_vehicle(size_class,int), save_product(uuid,text,text,size_class,numeric,int,boolean), move_stock(uuid,movement_kind,int,text),
  send_order(text,text,jsonb,timestamptz,text,jsonb,int,vehicle_type,numeric,text), link_my_orders(), owner_order(uuid),
  set_order_address(uuid,jsonb), owner_set_status(uuid,order_status,text), save_address(uuid,jsonb), delete_address(uuid),
  admin_orders(order_status,int)
  from public, anon;
grant execute on function slots_for(text,date), distance_km(numeric,numeric,numeric,numeric), fee_for(vehicle_type,numeric),
  suggest_vehicle(size_class,int), save_product(uuid,text,text,size_class,numeric,int,boolean), move_stock(uuid,movement_kind,int,text),
  send_order(text,text,jsonb,timestamptz,text,jsonb,int,vehicle_type,numeric,text), link_my_orders(), owner_order(uuid),
  set_order_address(uuid,jsonb), owner_set_status(uuid,order_status,text), save_address(uuid,jsonb), delete_address(uuid),
  admin_orders(order_status,int)
  to authenticated;
