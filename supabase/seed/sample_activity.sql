-- Ọ̀nà sample activity: fills the platform with shops, riders, customers and orders so it can be
-- shown working in real time. SAMPLE DATA ONLY: every name ends in "(sample)", every new login is
-- an @sample.ona.invalid address with no password (nobody can sign in as them), and no e-mail is sent.
--
-- Every order goes through the real database functions, acting as the role that would do it,
-- exactly as the app does. Only clock times are written directly (marked MODELLED): when a rider
-- waited, when a parcel was handed over, and moving finished days into the past.
--
--   * two weeks of finished deliveries (history for the dashboards and charts)
--   * today: orders at every stage, riders on the road with live positions, open problems
--   * the existing sample accounts take part: Adùnní Fabrics, Tolu (Operations), Emeka (rider),
--     Kemi (customer), so signing in as them shows live work.
--
-- Run once, as the database owner. Remove everything again with remove_sample_activity.sql.
do $seed$
declare
  T0 constant timestamptz := now();             -- transaction time: everything this run creates is stamped from here
  THR constant timestamptz := now() - interval '40 minutes';
  zones constant text[] := array['Lekki','Ikoyi','Victoria Island','Yaba','Surulere','Ikeja'];
  zlat constant numeric[] := array[6.4474, 6.4520, 6.4281, 6.5095, 6.4969, 6.6018];
  zlng constant numeric[] := array[3.4721, 3.4350, 3.4219, 3.3711, 3.3550, 3.3515];
  first_names constant text[] := array['Adaeze','Bola','Chioma','Damilola','Efe','Funmi','Gbemi','Halima','Ifeoma','Jide','Kemi','Lola','Mayowa','Nkechi','Ope',
    'Peju','Rasheed','Segun','Temi','Uche','Wale','Yemi','Zainab','Tobi','Ngozi','Emeka','Aisha','Kola','Bisi','Dayo'];
  last_names constant text[] := array['Adeyemi','Okafor','Bello','Eze','Balogun','Nwosu','Ogunleye','Ibrahim','Okon','Adebayo','Lawal','Obi','Salami','Afolabi','Uzor'];
  -- actors
  admin uuid; op uuid; op2 uuid;
  demo_biz uuid; demo_owner uuid; demo_rider uuid; demo_cust uuid; demo_cust_email text;
  biz uuid[] := '{}'; own uuid[] := '{}'; bzone int[] := '{}'; rds uuid[] := '{}';
  prods uuid[] := '{}'; prod_biz int[] := '{}';
  cust_email text[] := '{}'; cust_name text[] := '{}'; cust_id uuid[] := '{}'; cust_app boolean[] := '{}';
  -- working
  b int; k int; i int; n int; ci int; zi int; day int; o uuid; oref text; items jsonb; ws timestamptz; d date;
  g jsonb; rid uuid; rt uuid; st jsonb; j jsonb; code text; ids uuid[]; pay uuid; rn numeric; cl uuid; iv interval;
  oo record; r record; stage int; tries int; plat numeric; plng numeric; cnt jsonb := '{}';
  today_orders uuid[] := '{}';
begin
  perform setseed(0.1112);
  if exists (select 1 from businesses where name = 'Mama Tee''s Kitchen (sample)') then
    raise exception 'Sample activity is already loaded. Run remove_sample_activity.sql first.';
  end if;

  -- ------------------------------------------------ existing sample accounts
  select id into admin from profiles where role = 'super_admin' and status = 'active' order by created_at limit 1;
  select id into op from profiles where email = 'ops@demo.ona.test';
  select id, business_id into demo_owner, demo_biz from profiles where email = 'owner@demo.ona.test';
  select id into demo_rider from profiles where email = '2348035550177@rider.ona.invalid';
  select id, email into demo_cust, demo_cust_email from profiles where email = 'customer@demo.ona.test';
  if admin is null or op is null or demo_biz is null or demo_rider is null or demo_cust is null then
    raise exception 'The demo accounts were not found.';
  end if;

  -- ------------------------------------------------ new sample actors
  -- a second Operations person
  op2 := gen_random_uuid();
  insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at)
  values (op2, 'ngozi.ops@sample.ona.invalid', '{"ona_role":"operations","phone":"0809 555 0102"}', '{"full_name":"Ngozi Eze (sample)"}', now());

  -- six shops with owners, products and opening stock
  for r in select * from (values
      (1, 'Mama Tee''s Kitchen (sample)', 'Food & drinks', 4, '14 Herbert Macaulay Way, Yaba', 'Opposite the bus stop', 'Tolani Adeyemi (sample)',
          array['Jollof rice tray','Small chops box','Zobo, 6 bottles','Party pack (large)'], array[6500,9000,4000,25000]::numeric[], array['small','small','medium','large']),
      (2, 'Gadget Hub Ikeja (sample)', 'Electronics', 6, 'Shop 22, Computer Village, Ikeja', 'Beside the blue gate', 'Chinedu Okafor (sample)',
          array['Phone charger','Bluetooth earbuds','Power bank 20,000 mAh','24-inch monitor'], array[5500,18000,22000,95000]::numeric[], array['small','small','small','large']),
      (3, 'Glow by Bisi (sample)', 'Cosmetics & beauty', 1, '7 Admiralty Way, Lekki Phase 1', 'Second floor', 'Bisi Balogun (sample)',
          array['Shea butter set','Lip gloss trio','Skincare bundle','Hair care kit'], array[7000,6000,28000,15000]::numeric[], array['small','small','medium','medium']),
      (4, 'Ìrètí Pharmacy (sample)', 'Pharmacy & health', 5, '31 Adeniran Ogunsanya Street, Surulere', 'Next to the bank', 'Femi Afolabi (sample)',
          array['First aid kit','Vitamin C, 3 packs','Baby care pack','Blood pressure monitor'], array[8500,4500,12000,30000]::numeric[], array['small','small','medium','small']),
      (5, 'Tunde Shoes & Bags (sample)', 'Fashion', 3, '12 Adeola Odeku Street, Victoria Island', 'Ground floor', 'Tunde Lawal (sample)',
          array['Leather sandals','Office bag','Sneakers','Travel box'], array[15000,35000,28000,60000]::numeric[], array['small','medium','medium','large']),
      (6, 'Ọjà Fresh Groceries (sample)', 'General retail', 2, '5 Awolowo Road, Ikoyi', 'Behind the filling station', 'Amaka Nwosu (sample)',
          array['Fruit basket','Weekly food box','Rice, 25 kg','Drinks crate'], array[12000,30000,48000,16000]::numeric[], array['small','medium','large','large'])
    ) as t(n, name, sector, zi, addr, landmark, owner_name, pnames, pprices, psizes) loop
    insert into businesses (name, sector, zone, pickup_lat, pickup_lng, pickup_address, pickup_landmark, phone)
    values (r.name, r.sector, zones[r.zi], zlat[r.zi] + (random() - 0.5) * 0.01, zlng[r.zi] + (random() - 0.5) * 0.01, r.addr, r.landmark,
            '0802 555 01' || lpad((10 + r.n)::text, 2, '0'))
    returning id into o;
    biz := biz || o; bzone := bzone || r.zi;
    own := own || gen_random_uuid();
    insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at)
    values (own[r.n], 'owner' || r.n || '@sample.ona.invalid', jsonb_build_object('ona_role','owner','business_id',o,'phone','0802 555 01' || lpad((10 + r.n)::text, 2, '0')),
            jsonb_build_object('full_name', r.owner_name), now());
    perform set_config('request.jwt.claims', json_build_object('sub', own[r.n], 'role','authenticated')::text, true), set_config('role', 'authenticated', true);
    for k in 1..4 loop
      o := save_product(null, upper(left(regexp_replace(r.name, '[^A-Za-z]', '', 'g'), 3)) || '-' || lpad(k::text, 2, '0'), r.pnames[k] || ' (sample)',
                        r.psizes[k]::size_class, r.pprices[k], 5);
      perform move_stock(o, 'stock_in', 300, 'Opening stock');
      prods := prods || o; prod_biz := prod_biz || r.n;
    end loop;
    perform set_config('role', 'none', true);
  end loop;
  -- the existing sample shop takes part as shop 7 (restocked so it can fill its orders)
  biz := biz || demo_biz; own := own || demo_owner; bzone := bzone || 1;
  perform set_config('request.jwt.claims', json_build_object('sub', demo_owner, 'role','authenticated')::text, true), set_config('role', 'authenticated', true);
  for o in select id from products where business_id = demo_biz order by sku loop
    perform move_stock(o, 'stock_in', 200, 'Restock');
    prods := prods || o; prod_biz := prod_biz || 7;
  end loop;
  perform set_config('role', 'none', true);

  -- ten riders with vehicles (7 bikes, 2 cars, 1 van); the existing sample rider Emeka also works
  for r in select * from (values
      (1,'Musa Ibrahim (sample)','bike'),(2,'Sola Adebayo (sample)','bike'),(3,'Ifeanyi Obi (sample)','bike'),(4,'Kunle Salami (sample)','bike'),
      (5,'Yusuf Bello (sample)','bike'),(6,'Gbenga Ogunleye (sample)','bike'),(7,'Uche Uzor (sample)','bike'),(8,'Bayo Afolabi (sample)','car'),
      (9,'Femi Okon (sample)','car'),(10,'Chuks Nwosu (sample)','van')) as t(n, name, vt) loop
    rds := rds || gen_random_uuid();
    insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at)
    values (rds[r.n], 'rider' || r.n || '@sample.ona.invalid',
            jsonb_build_object('ona_role','rider','zone', zones[1 + (r.n % 6)], 'phone', '0803 555 02' || lpad(r.n::text, 2, '0'),
                               'licence_expiry', (current_date + 200 + r.n * 20)::text),
            jsonb_build_object('full_name', r.name), now());
    perform set_config('request.jwt.claims', json_build_object('sub', op, 'role','authenticated')::text, true), set_config('role', 'authenticated', true);
    perform attach_vehicle(rds[r.n], create_vehicle(r.vt::vehicle_type, 'LSR ' || (300 + r.n * 17) || ' ' || chr(65 + r.n) || chr(70 + r.n),
                                                     case r.vt when 'bike' then 3 when 'car' then 8 else 20 end, null));
    perform set_config('role', 'none', true);
  end loop;
  rds := rds || demo_rider;
  -- the sample rider needs a valid licence date to be offered routes (removed again by the clean-up)
  perform set_config('request.jwt.claims', json_build_object('sub', op, 'role','authenticated')::text, true), set_config('role', 'authenticated', true);
  perform set_rider(demo_rider, coalesce((select zone from riders where profile_id = demo_rider), 'Lekki'), current_date + 365, 'available');
  perform set_config('role', 'none', true);

  -- sixty customers (most use the app; some only receive orders by e-mail and phone); Kemi is customer 61
  for k in 1..60 loop
    cust_name := cust_name || (first_names[1 + floor(random() * 30)::int] || ' ' || last_names[1 + floor(random() * 15)::int] || ' (sample)');
    cust_email := cust_email || ('customer' || k || '@sample.ona.invalid');
    cust_app := cust_app || (random() < 0.85);
    cust_id := cust_id || gen_random_uuid();
    if cust_app[k] then
      insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at)
      values (cust_id[k], cust_email[k], jsonb_build_object('phone', '0806 555 ' || lpad((1000 + k)::text, 4, '0')),
              jsonb_build_object('full_name', cust_name[k]), now());
    end if;
  end loop;
  cust_name := cust_name || 'Kemi Customer (sample)'::text; cust_email := cust_email || demo_cust_email; cust_app := cust_app || true; cust_id := cust_id || demo_cust;

  -- MODELLED: the new shops, staff and riders joined about a month ago
  update businesses set created_at = created_at - interval '32 days' where id = any(biz[1:6]);
  update profiles set created_at = created_at - interval '32 days' where created_at >= THR and role <> 'customer';
  update profiles set created_at = created_at - make_interval(days => 3 + floor(random() * 25)::int) where created_at >= THR and role = 'customer';
  update riders set created_at = created_at - interval '32 days' where created_at >= THR;
  update vehicles set created_at = created_at - interval '32 days' where created_at >= THR;
  update products set created_at = created_at - interval '32 days' where created_at >= THR;
  update stock_movements set at = at - interval '32 days' where at >= THR;

  -- ------------------------------------------------ fourteen days of finished deliveries
  for day in reverse 14..1 loop
    n := case when extract(dow from current_date - day) = 0 then 5 else 9 + floor(random() * 7)::int end;
    d := current_date + 1;   -- created for tomorrow, then moved back to the right day (MODELLED)
    ids := '{}';
    for i in 1..n loop
      b := 1 + floor(random() * 7)::int;
      ci := case when random() < 0.04 then 61 else 1 + floor(random() * 60)::int end;
      zi := 1 + floor(random() * 6)::int;
      items := jsonb_build_array(jsonb_build_object('product_id', prods[(b - 1) * 4 + 1 + floor(random() * 4)::int], 'qty', 1 + floor(random() * 2)::int));
      if random() < 0.3 then
        items := items || jsonb_build_array(jsonb_build_object('product_id', prods[(b - 1) * 4 + 1 + floor(random() * 4)::int], 'qty', 1));
      end if;
      select s.w_start into ws from slot_windows(d) s order by random() limit 1;
      perform set_config('request.jwt.claims', json_build_object('sub', own[b], 'role','authenticated')::text, true), set_config('role', 'authenticated', true);
      begin
        oref := send_order(cust_email[ci], cust_name[ci], items, ws, zones[zi],
                  case when random() < 0.6 or not cust_app[ci] then jsonb_build_object('address', (10 + floor(random() * 80)::int) || ' Sample Street, ' || zones[zi],
                       'landmark', 'Near the junction', 'phone', '0806 555 ' || lpad((1000 + ci)::text, 4, '0'), 'zone', zones[zi]) end,
                  null, null, round((2 + random() * 22)::numeric, 1), null);
      exception when others then perform set_config('role', 'none', true); continue; end;
      select id into o from orders where ref = oref;
      perform set_config('role', 'none', true);
      if (select status from orders where id = o) = 'awaiting_address' then
        perform set_config('request.jwt.claims', json_build_object('sub', cust_id[ci], 'role','authenticated')::text, true), set_config('role', 'authenticated', true);
        perform link_my_orders();
        perform set_order_address(o, jsonb_build_object('address', (10 + floor(random() * 80)::int) || ' Customer Close, ' || zones[zi], 'landmark', 'Blue gate',
                                                         'phone', '0806 555 ' || lpad((1000 + ci)::text, 4, '0'), 'zone', zones[zi]));
        perform set_config('role', 'none', true);
      end if;
      perform set_config('request.jwt.claims', json_build_object('sub', own[b], 'role','authenticated')::text, true), set_config('role', 'authenticated', true);
      if random() < 0.03 then perform owner_set_status(o, 'cancelled', 'Customer changed their mind');
      else perform owner_set_status(o, 'packed'); end if;
      perform set_config('role', 'none', true);
    end loop;
    -- each shop pays for its packed orders; the super admin confirms (one in ten receipts rejected once)
    for b in 1..7 loop
      select array_agg(id order by ref) into ids from orders where business_id = biz[b] and status = 'packed';
      continue when ids is null;
      perform set_config('request.jwt.claims', json_build_object('sub', own[b], 'role','authenticated')::text, true), set_config('role', 'authenticated', true);
      rid := request_dispatch(ids);
      perform set_config('role', 'none', true);
      continue when (select status from dispatch_requests where id = rid) = 'confirmed';
      tries := case when random() < 0.1 then 1 else 0 end;
      for k in 0..tries loop
        perform set_config('request.jwt.claims', json_build_object('sub', own[b], 'role','authenticated')::text, true), set_config('role', 'authenticated', true);
        perform submit_payment(rid, 'TRF' || to_char(current_date - day, 'MMDD') || b || k || floor(random() * 9000 + 1000)::int,
                               biz[b] || '/receipt-sample.jpg', (select amount_due from dispatch_requests where id = rid));
        perform set_config('request.jwt.claims', json_build_object('sub', admin, 'role','authenticated')::text, true);
        select id into pay from payments where request_id = rid and status = 'pending';
        perform review_payment(pay, k = tries, case when k < tries then 'Amount does not match the transfer' end);
        perform set_config('role', 'none', true);
        exit when (select status from dispatch_requests where id = rid) in ('confirmed', 'closed');
      end loop;
      -- MODELLED: confirmed 2–20 minutes after the receipt was uploaded
      update payments set decided_at = created_at + make_interval(mins => (2 + floor(random() * 18))::int) where request_id = rid and decided_at is not null;
    end loop;
    -- Operations dispatches; riders collect and deliver
    perform set_config('request.jwt.claims', json_build_object('sub', op, 'role','authenticated')::text, true), set_config('role', 'authenticated', true);
    j := suggest_routes();
    perform set_config('role', 'none', true);
    for g in select v from jsonb_array_elements(coalesce(j, '[]')) v order by v->>'window_start' loop
      ids := array(select (v #>> '{}')::uuid from jsonb_array_elements(g->'order_ids') v);
      ids := array(select od.id from orders od where od.id = any(ids) and od.status = 'ready_for_pickup');
      continue when coalesce(array_length(ids, 1), 0) = 0;
      perform set_config('request.jwt.claims', json_build_object('sub', (case when random() < 0.5 then op else op2 end), 'role','authenticated')::text, true), set_config('role', 'authenticated', true);
      select a.rider_id into rid from available_riders((g->>'vehicle')::vehicle_type, (select sum(bags)::int from orders where id = any(ids))) a
        where a.rider_id = any(rds) order by a.trips_today, random() limit 1;
      if rid is null then perform set_config('role', 'none', true); continue; end if;
      rt := create_route(rid, ids, true, null);
      perform set_config('request.jwt.claims', json_build_object('sub', rid, 'role','authenticated')::text, true);
      perform respond_route(rt, true);
      for st in select s from jsonb_array_elements(rider_route()->'stops') s where s->>'kind' = 'pickup' loop
        perform arrive_stop((st->>'id')::uuid);
        perform set_config('role', 'none', true);
        update route_stops set arrived_at = now() - make_interval(secs => (case when random() < 0.15 then 12 + random() * 14 else 2 + random() * 8 end) * 60)
        where id = (st->>'id')::uuid;   -- MODELLED: minutes waited at the shop
        perform set_config('request.jwt.claims', json_build_object('sub', own[array_position(biz, (select business_id from route_stops where id = (st->>'id')::uuid))], 'role','authenticated')::text, true),
                set_config('role', 'authenticated', true);
        select p->>'code' into code from jsonb_array_elements(owner_pickups()) p where p->>'stop_id' = st->>'id';
        perform set_config('request.jwt.claims', json_build_object('sub', rid, 'role','authenticated')::text, true);
        j := confirm_pickup((st->>'id')::uuid, code, (st->'business'->>'bags')::int, 'sample/bags.jpg');
      end loop;
      perform set_config('role', 'none', true);
      for oo in select od.id, od.customer_id, od.window_end from orders od where od.route_id = rt and od.status = 'out_for_delivery' order by od.ref loop
        rn := random();
        perform set_config('request.jwt.claims', json_build_object('sub', rid, 'role','authenticated')::text, true), set_config('role', 'authenticated', true);
        if rn < 0.04 then
          perform fail_delivery(oo.id, 'Customer not home');
          perform set_config('request.jwt.claims', json_build_object('sub', op, 'role','authenticated')::text, true);
          perform resolve_failed_delivery(oo.id, 'customer', 'Returned to the shop');
          perform set_config('role', 'none', true);
          continue;
        end if;
        if rn < 0.11 then perform report_delay(oo.id, oo.window_end + make_interval(mins => (15 + floor(random() * 40))::int), 'Heavy traffic'); end if;
        code := null;
        if oo.customer_id is not null then
          perform set_config('request.jwt.claims', json_build_object('sub', oo.customer_id, 'role','authenticated')::text, true);
          code := order_tracking(oo.id)->>'delivery_code';
        end if;
        perform set_config('request.jwt.claims', json_build_object('sub', rid, 'role','authenticated')::text, true);
        if code is null then
          perform set_config('request.jwt.claims', json_build_object('sub', op, 'role','authenticated')::text, true);
          perform override_delivery(oo.id, 'Phoned the customer, confirmed name and items');
        else
          j := deliver_order(oo.id, code, 'sample/door.jpg');
        end if;
        perform set_config('role', 'none', true);
        -- MODELLED: when the parcel was handed over
        update orders set delivered_at = case when rn < 0.11 then eta
                                              when rn < 0.15 then window_end + make_interval(mins => (10 + floor(random() * 25))::int)
                                              else window_start + (window_end - window_start) * (0.1 + random() * 0.85) end
        where id = oo.id and status = 'delivered';
      end loop;
    end loop;
    -- ratings and claims on today's deliveries
    for oo in select od.id, od.customer_id, od.business_id from orders od where od.status = 'delivered' and od.created_at >= THR
              and not exists (select 1 from order_feedback f where f.order_id = od.id) order by od.ref loop
      if oo.customer_id is not null and random() < 0.6 then
        perform set_config('request.jwt.claims', json_build_object('sub', oo.customer_id, 'role','authenticated')::text, true), set_config('role', 'authenticated', true);
        perform rate_order(oo.id, (array[3,4,4,5,5,5,5])[1 + floor(random() * 7)::int],
                           (array[null, null, 'Rider was polite', 'Fast delivery, thank you', 'Came on time', null, 'Packaging was neat'])[1 + floor(random() * 7)::int]);
        perform set_config('role', 'none', true);
      end if;
      if random() < 0.03 then
        perform set_config('request.jwt.claims', json_build_object('sub', own[array_position(biz, oo.business_id)], 'role','authenticated')::text, true), set_config('role', 'authenticated', true);
        cl := open_claim(oo.id, 'damage', round((5000 + random() * 40000)::numeric, -2), 'Item arrived damaged');
        if day > 1 then
          perform set_config('request.jwt.claims', json_build_object('sub', op, 'role','authenticated')::text, true);
          rn := random();
          perform decide_claim(cl, (case when rn < 0.5 then 'rider' else 'store' end)::claim_cause, rn < 0.5, 'Checked the pickup and door photos');
          if rn < 0.5 then
            perform set_config('request.jwt.claims', json_build_object('sub', admin, 'role','authenticated')::text, true);
            perform mark_claim_paid(cl, 'REF' || floor(random() * 90000 + 10000)::int);
          end if;
        end if;
        perform set_config('role', 'none', true);
      end if;
    end loop;
    -- MODELLED: move this day's records back to their real date
    iv := make_interval(days => day + 1);
    for r in select c.table_name t, string_agg(format('%1$I = case when %1$I >= $2 then %1$I - $1 else %1$I end', c.column_name), ', ') s,
                    string_agg(format('%I >= $2', c.column_name), ' or ') w
             from information_schema.columns c
             where c.table_schema = 'public' and c.data_type = 'timestamp with time zone'
               and c.table_name in ('orders','order_events','dispatch_requests','payments','routes','route_stops','codes','issues','claims',
                                    'order_feedback','notifications','business_adjustments','business_customers','audit_log','rider_locations','rider_payouts','customer_addresses')
             group by 1 loop
      execute format('update %I set %s where %s', r.t, r.s, r.w) using iv, THR;
    end loop;
    update stock_movements set at = at - iv where at >= THR;
  end loop;

  -- Operations closed the traffic notices on orders that were delivered
  perform set_config('request.jwt.claims', json_build_object('sub', op, 'role','authenticated')::text, true), set_config('role', 'authenticated', true);
  for r in select i2.id from issues i2 join orders o2 on o2.id = i2.order_id where i2.status = 'open' and i2.kind = 'delay' and o2.status = 'delivered' loop
    perform resolve_issue(r.id, 'Customer told about the traffic; delivered');
  end loop;
  perform set_config('role', 'none', true);
  update issues set resolved_at = created_at + make_interval(mins => (20 + floor(random() * 100))::int) where resolved_at >= THR;   -- MODELLED

  -- MODELLED: each finished order's timeline runs from when it was placed to when it was handed over
  update order_events e set at = x.t from (
    select e2.id, o2.created_at + (coalesce(o2.delivered_at, o2.window_start) - o2.created_at)
             * (row_number() over (partition by e2.order_id order by e2.id) - 1)::numeric
             / greatest(count(*) over (partition by e2.order_id) - 1, 1) t
    from order_events e2 join orders o2 on o2.id = e2.order_id
    where o2.status in ('delivered','returned') and o2.created_at < THR) x
  where x.id = e.id;
  update routes ro set created_at = x.first_pick - interval '35 minutes' from (
    select route_id, min(window_start) first_pick from orders where route_id is not null and created_at < THR group by 1) x
  where x.route_id = ro.id;

  -- ------------------------------------------------ today: work at every stage
  d := current_date;
  if not exists (select 1 from slot_windows(d) s where s.w_start > now() + interval '75 minutes') then d := current_date + 1; end if;
  for i in 1..34 loop
    -- stage: 1-5 to pack · 6-8 waiting for payment · 9-12 receipt to confirm · 13-19 waiting for a rider
    --        20-21 route offered · 22-27 on the road · 28-30 delivered this morning · 31-34 problems
    stage := i;
    b := case when i in (1, 9, 13, 22, 23, 28) then 7 else 1 + ((i * 5) % 6) end;
    ci := case when i in (6, 22, 28) then 61 else 1 + floor(random() * 60)::int end;
    zi := 1 + floor(random() * 6)::int;
    items := case when i >= 20 then jsonb_build_array(jsonb_build_object('product_id', prods[(b - 1) * 4 + 1], 'qty', 1))   -- small parcels: fit a bike
                  else jsonb_build_array(jsonb_build_object('product_id', prods[(b - 1) * 4 + 1 + floor(random() * 3)::int], 'qty', 1 + floor(random() * 2)::int)) end;
    select s.w_start into ws from slot_windows(d) s where s.w_start > now() + interval '75 minutes' order by s.w_start
      offset (case when stage >= 20 then 0 else floor(random() * 2)::int end) limit 1;
    if ws is null then select s.w_start into ws from slot_windows(d) s where s.w_start > now() + interval '75 minutes' order by s.w_start limit 1; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', own[b], 'role','authenticated')::text, true), set_config('role', 'authenticated', true);
    oref := send_order(cust_email[ci], cust_name[ci], items, ws, zones[zi],
              case when (stage > 3 or not cust_app[ci]) then jsonb_build_object('address', (10 + floor(random() * 80)::int) || ' Sample Street, ' || zones[zi],
                   'landmark', 'Near the junction', 'phone', '0806 555 ' || lpad((1000 + ci)::text, 4, '0'), 'zone', zones[zi]) end,
              null, null, round((2 + random() * 22)::numeric, 1), case when stage = 1 then 'Please call before coming' end);
    select id into o from orders where ref = oref;
    today_orders := today_orders || o;
    if stage > 5 then perform owner_set_status(o, 'packed'); end if;
    perform set_config('role', 'none', true);
  end loop;
  -- payments: 6-8 wait for the receipt, 9-12 wait for the super admin, 13+ confirmed
  for i in 6..34 loop
    o := today_orders[i];
    b := array_position(biz, (select business_id from orders where id = o));
    perform set_config('request.jwt.claims', json_build_object('sub', own[b], 'role','authenticated')::text, true), set_config('role', 'authenticated', true);
    rid := request_dispatch(array[o]);
    if i >= 9 and (select status from dispatch_requests where id = rid) <> 'confirmed' then
      perform submit_payment(rid, 'TRF' || to_char(current_date, 'MMDD') || i || floor(random() * 9000 + 1000)::int, biz[b] || '/receipt-sample.jpg',
                             (select amount_due from dispatch_requests where id = rid));
      if i >= 13 then
        perform set_config('request.jwt.claims', json_build_object('sub', admin, 'role','authenticated')::text, true);
        perform review_payment((select id from payments where request_id = rid and status = 'pending'), true, null);
      end if;
    end if;
    perform set_config('role', 'none', true);
  end loop;
  -- MODELLED: today's payments and requests arrived over the last two hours
  update payments set created_at = now() - make_interval(mins => (5 + floor(random() * 110))::int) where created_at >= THR;
  update payments set decided_at = created_at + make_interval(mins => (3 + floor(random() * 12))::int) where created_at >= now() - interval '3 hours' and decided_at is not null;
  update payments set created_at = now() - make_interval(mins => (2 + floor(random() * 9))::int) where status = 'pending';   -- receipts waiting: under the 15-minute target
  update orders set created_at = now() - make_interval(mins => (10 + floor(random() * 150))::int) where id = any(today_orders);

  -- routes: 20-21 offered, 22-27 accepted and moving, 28-30 delivered, 31-34 problems
  for i in 20..34 loop
    perform set_config('role', 'none', true);
    o := today_orders[i];
    continue when (select status from orders where id = o) <> 'ready_for_pickup';
    perform set_config('request.jwt.claims', json_build_object('sub', op, 'role','authenticated')::text, true), set_config('role', 'authenticated', true);
    -- Operations picks a free rider whose vehicle fits (Emeka takes the sample shop's two orders)
    if i = 22 then rid := demo_rider;
    else
      select a.rider_id into rid from available_riders((select vehicle_type from orders where id = o), (select bags from orders where id = o)) a
        where a.rider_id = any(rds) and a.rider_id <> demo_rider order by a.trips_today, random() limit 1;
    end if;
    if i = 23 then   -- Emeka's route carries two orders from the sample shop
      continue;
    end if;
    begin
      rt := create_route(rid, case when i = 22 then array[o, today_orders[23]] else array[o] end, false, null);
    exception when others then raise notice 'ROUTE % rider % : %', i, rid, sqlerrm; perform set_config('role', 'none', true); continue; end;
    perform set_config('role', 'none', true);
    select bz.pickup_lat, bz.pickup_lng into plat, plng from businesses bz join orders od on od.business_id = bz.id where od.id = o;
    zi := array_position(zones, (select zone from orders where id = o));
    continue when i in (20, 21);   -- offered, waiting for the rider to accept
    perform set_config('request.jwt.claims', json_build_object('sub', rid, 'role','authenticated')::text, true), set_config('role', 'authenticated', true);
    perform respond_route(rt, true);
    perform ping_location(plat - 0.012, plng + 0.009);
    continue when i in (22, 24);   -- riding to the shop (Emeka's pickup is left for you to do)
    for st in select s from jsonb_array_elements(rider_route()->'stops') s where s->>'kind' = 'pickup' loop
      perform arrive_stop((st->>'id')::uuid);
      exit when i = 25;            -- waiting at the shop
      perform set_config('role', 'none', true);
      perform set_config('request.jwt.claims', json_build_object('sub', own[array_position(biz, (select business_id from route_stops where id = (st->>'id')::uuid))], 'role','authenticated')::text, true),
              set_config('role', 'authenticated', true);
      select p->>'code' into code from jsonb_array_elements(owner_pickups()) p where p->>'stop_id' = st->>'id';
      perform set_config('request.jwt.claims', json_build_object('sub', rid, 'role','authenticated')::text, true);
      j := confirm_pickup((st->>'id')::uuid, code, (st->'business'->>'bags')::int, 'sample/bags.jpg');
    end loop;
    perform set_config('role', 'none', true);
    continue when i = 25;
    -- the rider's trail from the shop towards the customer (MODELLED times)
    perform set_config('request.jwt.claims', json_build_object('sub', rid, 'role','authenticated')::text, true), set_config('role', 'authenticated', true);
    for k in 1..6 loop
      perform ping_location(plat + (zlat[zi] - plat) * k / 8.0, plng + (zlng[zi] - plng) * k / 8.0);
    end loop;
    perform set_config('role', 'none', true);
    continue when i in (26, 27);   -- out for delivery now
    if i = 31 then                 -- traffic: new arrival time beyond the window
      ws := (select window_end from orders where id = o);
      perform set_config('request.jwt.claims', json_build_object('sub', rid, 'role','authenticated')::text, true), set_config('role', 'authenticated', true);
      perform report_delay(o, ws + interval '35 minutes', 'Heavy traffic on Third Mainland Bridge');
      perform set_config('role', 'none', true);
      continue;
    end if;
    if i = 32 then                 -- failed delivery waiting for Operations
      perform set_config('request.jwt.claims', json_build_object('sub', rid, 'role','authenticated')::text, true), set_config('role', 'authenticated', true);
      perform fail_delivery(o, 'Customer unreachable');
      perform set_config('role', 'none', true);
      continue;
    end if;
    if i = 33 then                 -- five wrong delivery codes: locked, Operations must step in
      perform set_config('request.jwt.claims', json_build_object('sub', rid, 'role','authenticated')::text, true), set_config('role', 'authenticated', true);
      for k in 1..5 loop j := deliver_order(o, lpad((111111 * k)::text, 6, '0'), 'sample/door.jpg'); end loop;
      perform set_config('role', 'none', true);
      continue;
    end if;
    -- 28-30 and 34: delivered this morning
    code := null;
    if (select customer_id from orders where id = o) is not null then
      perform set_config('request.jwt.claims', json_build_object('sub', (select customer_id from orders where id = o), 'role','authenticated')::text, true), set_config('role', 'authenticated', true);
      code := order_tracking(o)->>'delivery_code';
    end if;
    if code is null then
      perform set_config('request.jwt.claims', json_build_object('sub', op, 'role','authenticated')::text, true), set_config('role', 'authenticated', true);
      perform override_delivery(o, 'Phoned the customer, confirmed name and items');
    else
      perform set_config('request.jwt.claims', json_build_object('sub', rid, 'role','authenticated')::text, true), set_config('role', 'authenticated', true);
      j := deliver_order(o, code, 'sample/door.jpg');
    end if;
    perform set_config('role', 'none', true);
  end loop;
  -- an open claim from yesterday for Operations to decide
  select od.id, od.business_id into oo from orders od where od.status = 'delivered' and od.delivered_at > now() - interval '30 hours'
    and od.business_id <> demo_biz and not exists (select 1 from claims c where c.order_id = od.id) order by od.delivered_at desc limit 1;
  if oo.id is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', own[array_position(biz, oo.business_id)], 'role','authenticated')::text, true), set_config('role', 'authenticated', true);
    perform open_claim(oo.id, 'missing', 12000, 'One item was missing from the bag');
    perform set_config('role', 'none', true);
  end if;
  -- MODELLED: today's activity spread over the morning; positions a few minutes apart, newest last
  update rider_locations l set at = now() - make_interval(secs => x.rk * 75) from (
    select id, row_number() over (partition by route_id order by id desc) - 1 rk from rider_locations where at >= THR) x where x.id = l.id;
  update order_events e set at = least(now(), o2.created_at + (now() - o2.created_at)
           * (x.rk - 1)::numeric / greatest(x.cnt - 1, 1))
  from (select e2.id, e2.order_id, row_number() over (partition by e2.order_id order by e2.id) rk, count(*) over (partition by e2.order_id) cnt
        from order_events e2 where e2.order_id = any(today_orders)) x
  join orders o2 on o2.id = x.order_id
  where e.id = x.id;
  update orders set delivered_at = now() - make_interval(mins => (5 + floor(random() * 50))::int) where id = any(today_orders) and status = 'delivered';

  raise notice 'SAMPLE_REPORT %', (select jsonb_build_object(
    'businesses', (select count(*) from businesses), 'riders', (select count(*) from riders), 'customers', (select count(*) from profiles where role = 'customer'),
    'orders', (select count(*) from orders),
    'by_status', (select jsonb_object_agg(status, nn) from (select status, count(*) nn from orders group by 1) s),
    'today', (select jsonb_object_agg(status, nn) from (select status, count(*) nn from orders where id = any(today_orders) group by 1) s),
    'first_day', (select min(created_at)::date from orders), 'ratings', (select count(*) from order_feedback),
    'claims', (select count(*) from claims), 'open_issues', (select count(*) from issues where status = 'open'),
    'locations', (select count(*) from rider_locations)));
end $seed$;
