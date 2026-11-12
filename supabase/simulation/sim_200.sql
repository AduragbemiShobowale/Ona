-- Ọ̀nà 200-order simulation (dissertation chapter 4, system verification).
--
-- Drives 200 orders through the real database functions, acting as each of the five roles in turn,
-- exactly as the app does. Nothing is written straight into a table except where the simulated
-- clock has to move (minutes a rider waits, the time a parcel is handed over): those lines are
-- marked MODELLED. Outcome rates (failed pickups, wrong codes, traffic, claims…) are assumptions
-- set in the PARAMETERS block, not observations.
--
-- Fixed random seed: re-running gives the same results.
-- Runs as one block and always rolls back; the result is in the final error message (SIM_REPORT {...}).
-- Safe on the live project. Locally: build the database from the migrations (after tests/local_stub.sql).
do $sim$
declare
  -- PARAMETERS (assumptions)
  n_orders      constant int := 200;
  wave_size     constant int := 10;
  p_biz_address constant numeric := 0.55;  -- business types the address; otherwise the customer chooses it
  p_restock     constant numeric := 0.05;  -- order waits for restock before packing
  p_cancel_pre  constant numeric := 0.03;  -- cancelled before payment
  p_cancel_paid constant numeric := 0.02;  -- cancelled after payment, before pickup (credit)
  p_expire      constant numeric := 0.02;  -- no receipt within 2 hours
  p_reject_once constant numeric := 0.09;  -- receipt rejected once, then accepted
  p_reject_3x   constant numeric := 0.03;  -- receipt rejected three times (request closes)
  p_decline     constant numeric := 0.02;  -- rider declines a route
  p_fail_pickup constant numeric := 0.03;  -- failed pickup (2/3 business-caused)
  p_long_wait   constant numeric := 0.15;  -- rider waits 15–28 minutes at the shop
  p_wrong_pick  constant numeric := 0.08;  -- one wrong pickup code first
  p_change      constant numeric := 0.02;  -- rider changed mid-trip
  p_delay       constant numeric := 0.08;  -- traffic notice, arrives after the window
  p_late_quiet  constant numeric := 0.04;  -- late without a notice
  p_fail_drop   constant numeric := 0.04;  -- failed delivery (60% customer-caused)
  p_wrong_once  constant numeric := 0.10;  -- one wrong delivery code first
  p_lockout     constant numeric := 0.015; -- five wrong delivery codes (lock, Operations override)
  p_rate        constant numeric := 0.60;  -- customer rates the delivery
  p_claim       constant numeric := 0.04;  -- business claims on a delivered order
  p_late_claim  constant numeric := 0.01;  -- business tries a missing-item claim after 24 h
  zones constant text[] := array['Lekki','Ikoyi','Victoria Island','Yaba','Surulere','Ikeja'];
  -- actors
  sa uuid := gen_random_uuid(); op uuid := gen_random_uuid();
  biz uuid[] := '{}'; own uuid[] := '{}'; rds uuid[] := '{}'; prods uuid[] := '{}'; prod_biz uuid[] := '{}';
  cust_email text[] := '{}'; cust_kind text[] := '{}'; cust_id uuid[] := '{}';
  -- working
  t0 timestamptz; t_start timestamptz := clock_timestamp(); tim jsonb := '[]'; c jsonb := '{}';
  w int := 0; made int := 0; i int; k int; b int; ci int; o uuid; oref text; items jsonb; d date; ws timestamptz; zn text;
  g jsonb; rid uuid; rt uuid; st jsonb; j jsonb; code text; ids uuid[]; pay uuid; tries int; rn numeric; e text;
  oo record; newr uuid; leak int; cl uuid; rep jsonb;
begin
  perform setseed(0.2026);

  -- ------------------------------------------------ actors (sample data only)
  insert into auth.users (id, email, raw_app_meta_data, email_confirmed_at) values
    (sa, 'sim-admin@ona.test', '{"ona_role":"super_admin"}', now()),
    (op, 'sim-ops@ona.test', '{"ona_role":"operations","ops_lead":true}', now());
  for b in 1..3 loop
    insert into businesses (name, sector, zone, pickup_lat, pickup_lng, pickup_address)
      values ('Sim case ' || chr(64 + b) || ' (sample)', (array['Fashion','Food','Electronics'])[b], (array['Lekki','Yaba','Ikeja'])[b],
              (array[6.4474, 6.5095, 6.6018])[b], (array[3.4721, 3.3711, 3.3515])[b], 'Sample pickup ' || b) returning id into o;
    biz := biz || o;
    own := own || gen_random_uuid();
    insert into auth.users (id, email, raw_app_meta_data, email_confirmed_at)
    values (own[b], 'sim-owner' || b || '@ona.test', jsonb_build_object('ona_role','owner','business_id',biz[b]), now());
  end loop;
  for k in 1..8 loop
    rds := rds || gen_random_uuid();
    insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at)
    values (rds[k], 'sim-rider' || k || '@rider.ona.invalid', '{"ona_role":"rider","zone":"Lagos"}', jsonb_build_object('full_name','Sim rider ' || k), now());
  end loop;
  for k in 1..140 loop
    cust_email := cust_email || ('sim-cust' || k || '@ona.test');
    rn := random();
    cust_kind := cust_kind || case when rn < 0.65 then 'registered' when rn < 0.92 then 'later' else 'never' end;
    cust_id := cust_id || gen_random_uuid();
    if cust_kind[k] = 'registered' then
      insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values (cust_id[k], cust_email[k], now(), '{"phone":"0800 000 0000"}');
    end if;
  end loop;

  -- Operations: vehicles (5 bikes, 2 cars, 1 van)
  perform set_config('request.jwt.claims', json_build_object('sub', op, 'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  for k in 1..8 loop
    perform attach_vehicle(rds[k], create_vehicle((case when k <= 5 then 'bike' when k <= 7 then 'car' else 'van' end)::vehicle_type, 'SIM ' || lpad(k::text, 3, '0'),
                                                     case when k <= 5 then 4 when k <= 7 then 8 else 12 end));
  end loop;
  perform set_config('role', 'none', true);

  -- Owners: products and opening stock
  for b in 1..3 loop
    perform set_config('request.jwt.claims', json_build_object('sub', own[b], 'role','authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    for k in 1..4 loop
      o := save_product(null, 'S' || b || '-' || k, 'Sample item ' || b || '.' || k,
                        (case when b = 3 and k = 4 then 'large' when k = 3 then 'medium' else 'small' end)::size_class, 2000 * k * b, 5);
      perform move_stock(o, 'stock_in', 400, 'Simulation opening stock');
      prods := prods || o; prod_biz := prod_biz || biz[b];
    end loop;
    perform set_config('role', 'none', true);
  end loop;

  -- ------------------------------------------------ waves of orders until every order is settled
  while (made < n_orders or exists (select 1 from orders od where od.business_id = any(biz) and od.status not in ('delivered','cancelled','returned','claim_open')))
        and w < 40 loop
    w := w + 1;

    -- 1. owners create orders
    for i in 1..least(wave_size, n_orders - made) loop
      made := made + 1;
      b := 1 + floor(random() * 3)::int;
      ci := 1 + floor(random() * 140)::int;
      items := '[]';
      for k in 1..(1 + floor(random() * 2)::int) loop
        items := items || jsonb_build_array(jsonb_build_object('product_id', prods[(b - 1) * 4 + 1 + floor(random() * 4)::int], 'qty', 1 + floor(random() * 2)::int));
      end loop;
      -- anchored to a Sunday so the weekday pattern (and so every result) is the same whatever day it runs
      d := current_date + 2 + ((7 - extract(dow from current_date + 2)::int) % 7) + (w % 7);
      select s.w_start into ws from slot_windows(d) s order by random() limit 1;
      zn := zones[1 + floor(random() * 6)::int];
      perform set_config('request.jwt.claims', json_build_object('sub', own[b], 'role','authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      begin
        t0 := clock_timestamp();
        oref := send_order(cust_email[ci], 'Sim customer ' || ci, items, ws, zn,
                  case when random() < p_biz_address then jsonb_build_object('address', 'Sample address ' || made, 'phone', '0800 000 0000', 'zone', zn) end,
                  null, null, round((random() * 28 + 1)::numeric, 1), null);
        tim := tim || jsonb_build_array(jsonb_build_array('send_order', extract(epoch from clock_timestamp() - t0) * 1000));
        c := c || jsonb_build_object('orders_created', coalesce((c->>'orders_created')::int, 0) + 1);
      exception when others then
        c := c || jsonb_build_object('orders_refused', coalesce((c->>'orders_refused')::int, 0) + 1);
        perform set_config('role', 'none', true);
        continue;
      end;
      select id into o from orders where ref = oref;
      -- illegal move attempted by the owner (must be refused)
      if random() < 0.3 then
        c := c || jsonb_build_object('illegal_attempts', coalesce((c->>'illegal_attempts')::int, 0) + 1);
        begin perform owner_set_status(o, 'delivered'); exception when others then
          c := c || jsonb_build_object('illegal_refused', coalesce((c->>'illegal_refused')::int, 0) + 1); end;
      end if;
      perform set_config('role', 'none', true);

      -- address: the customer chooses it (signing up first if needed), or the business adds it
      if (select status from orders where id = o) = 'awaiting_address' then
        if cust_kind[ci] = 'later' and not exists (select 1 from auth.users u where u.id = cust_id[ci]) then
          insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values (cust_id[ci], cust_email[ci], now(), '{"phone":"0800 000 0000"}');
          c := c || jsonb_build_object('customers_signed_up_later', coalesce((c->>'customers_signed_up_later')::int, 0) + 1);
        end if;
        if cust_kind[ci] <> 'never' then
          perform set_config('request.jwt.claims', json_build_object('sub', cust_id[ci], 'role','authenticated')::text, true);
          perform set_config('role', 'authenticated', true);
          t0 := clock_timestamp(); perform link_my_orders();
          tim := tim || jsonb_build_array(jsonb_build_array('link_my_orders', extract(epoch from clock_timestamp() - t0) * 1000));
          t0 := clock_timestamp(); perform set_order_address(o, jsonb_build_object('address', 'Customer address ' || ci, 'phone', '0800 000 0000', 'zone', zn));
          tim := tim || jsonb_build_array(jsonb_build_array('set_order_address', extract(epoch from clock_timestamp() - t0) * 1000));
          c := c || jsonb_build_object('address_by_customer', coalesce((c->>'address_by_customer')::int, 0) + 1);
        else
          perform set_config('request.jwt.claims', json_build_object('sub', own[b], 'role','authenticated')::text, true);
          perform set_config('role', 'authenticated', true);
          perform set_order_address(o, jsonb_build_object('address', 'Phoned-in address ' || ci, 'phone', '0800 000 0000', 'zone', zn));
          c := c || jsonb_build_object('address_by_business_later', coalesce((c->>'address_by_business_later')::int, 0) + 1);
        end if;
        perform set_config('role', 'none', true);
      end if;

      -- pack (sometimes after a restock), or cancel before payment
      perform set_config('request.jwt.claims', json_build_object('sub', own[b], 'role','authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      if random() < p_cancel_pre then
        perform owner_set_status(o, 'cancelled', 'Customer changed their mind');
        c := c || jsonb_build_object('cancelled_before_payment', coalesce((c->>'cancelled_before_payment')::int, 0) + 1);
      else
        if random() < p_restock then perform owner_set_status(o, 'waiting_restock', 'Restock'); perform owner_set_status(o, 'received', 'Restocked'); end if;
        t0 := clock_timestamp(); perform owner_set_status(o, 'packed');
        tim := tim || jsonb_build_array(jsonb_build_array('owner_set_status', extract(epoch from clock_timestamp() - t0) * 1000));
      end if;
      perform set_config('role', 'none', true);
    end loop;

    -- 2. each owner sends its packed orders with one payment
    for b in 1..3 loop
      select array_agg(id order by length(ref), ref) into ids from orders where business_id = biz[b] and status = 'packed';
      continue when ids is null;
      perform set_config('request.jwt.claims', json_build_object('sub', own[b], 'role','authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      t0 := clock_timestamp(); rid := request_dispatch(ids);
      tim := tim || jsonb_build_array(jsonb_build_array('request_dispatch', extract(epoch from clock_timestamp() - t0) * 1000));
      perform set_config('role', 'none', true);
      continue when (select status from dispatch_requests where id = rid) = 'confirmed';   -- fully covered by credit
      if random() < p_expire then   -- MODELLED: the 2-hour limit passes with no receipt
        update dispatch_requests set due_at = now() - interval '1 minute' where id = rid;
        perform set_config('request.jwt.claims', json_build_object('sub', sa, 'role','authenticated')::text, true);
        perform set_config('role', 'authenticated', true);
        perform expire_overdue_requests();
        perform set_config('role', 'none', true);
        c := c || jsonb_build_object('requests_expired', coalesce((c->>'requests_expired')::int, 0) + 1);
        continue;
      end if;
      rn := random();
      tries := case when rn < p_reject_3x then 3 when rn < p_reject_3x + p_reject_once then 1 else 0 end;
      for k in 0..tries loop
        perform set_config('request.jwt.claims', json_build_object('sub', own[b], 'role','authenticated')::text, true);
        perform set_config('role', 'authenticated', true);
        t0 := clock_timestamp();
        perform submit_payment(rid, 'SIM-TRF-' || w || '-' || b || '-' || k, biz[b] || '/sim-receipt.jpg', (select amount_due from dispatch_requests where id = rid));
        tim := tim || jsonb_build_array(jsonb_build_array('submit_payment', extract(epoch from clock_timestamp() - t0) * 1000));
        perform set_config('request.jwt.claims', json_build_object('sub', sa, 'role','authenticated')::text, true);
        select id into pay from payments where request_id = rid and status = 'pending';
        t0 := clock_timestamp();
        if k < tries then perform review_payment(pay, false, 'Amount does not match');
        else perform review_payment(pay, true, null); end if;
        tim := tim || jsonb_build_array(jsonb_build_array('review_payment', extract(epoch from clock_timestamp() - t0) * 1000));
        perform set_config('role', 'none', true);
        exit when (select status from dispatch_requests where id = rid) = 'closed';
      end loop;
      -- MODELLED: the super admin confirmed within the target (minutes after upload)
      update payments set decided_at = created_at + make_interval(mins => (2 + floor(random() * 20))::int) where request_id = rid and decided_at is not null;
    end loop;

    -- 3. some paid orders are cancelled before pickup (credit)
    for oo in select od.id, od.business_id from orders od where od.business_id = any(biz) and od.status = 'ready_for_pickup' order by length(od.ref), od.ref loop
      continue when random() >= p_cancel_paid;
      perform set_config('request.jwt.claims', json_build_object('sub', own[array_position(biz, oo.business_id)], 'role','authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      perform owner_set_status(oo.id, 'cancelled', 'Customer no longer needs it');
      perform set_config('role', 'none', true);
      c := c || jsonb_build_object('cancelled_after_payment', coalesce((c->>'cancelled_after_payment')::int, 0) + 1);
    end loop;

    -- 4. Operations dispatches the queue (suggested groups; single orders if no rider fits a group)
    perform set_config('request.jwt.claims', json_build_object('sub', op, 'role','authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    t0 := clock_timestamp(); j := suggest_routes();
    tim := tim || jsonb_build_array(jsonb_build_array('suggest_routes', extract(epoch from clock_timestamp() - t0) * 1000));
    perform set_config('role', 'none', true);
    for g in select v from jsonb_array_elements(coalesce(j, '[]')) v
                order by v->>'window_start', (select min(length(r) || r) from jsonb_array_elements_text(v->'refs') r) loop
      ids := array(select (v #>> '{}')::uuid from jsonb_array_elements(g->'order_ids') v);
      ids := array(select od.id from orders od where od.id = any(ids) and od.business_id = any(biz) and od.status = 'ready_for_pickup');
      continue when coalesce(array_length(ids, 1), 0) = 0;
      perform set_config('request.jwt.claims', json_build_object('sub', op, 'role','authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      select a.rider_id into rid from available_riders((g->>'vehicle')::vehicle_type, (select sum(bags)::int from orders where id = any(ids))) a
        where a.rider_id = any(rds) order by a.trips_today, a.full_name limit 1;
      if rid is null then  -- no single vehicle fits: send the orders separately
        perform set_config('role', 'none', true);
        continue;
      end if;
      t0 := clock_timestamp(); rt := create_route(rid, ids, true, null);
      tim := tim || jsonb_build_array(jsonb_build_array('create_route', extract(epoch from clock_timestamp() - t0) * 1000));
      c := c || jsonb_build_object('routes', coalesce((c->>'routes')::int, 0) + 1);
      if array_length(ids, 1) > 1 then c := c || jsonb_build_object('combined_routes', coalesce((c->>'combined_routes')::int, 0) + 1); end if;
      perform set_config('role', 'none', true);

      -- 5. the rider works the route
      perform set_config('request.jwt.claims', json_build_object('sub', rid, 'role','authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      if random() < p_decline then
        perform respond_route(rt, false, 'Vehicle problem');
        c := c || jsonb_build_object('routes_declined', coalesce((c->>'routes_declined')::int, 0) + 1);
        perform set_config('role', 'none', true);
        continue;
      end if;
      perform respond_route(rt, true);
      for st in select s from jsonb_array_elements(rider_route()->'stops') s where s->>'kind' = 'pickup' order by s->'business'->>'name' loop
        t0 := clock_timestamp(); perform arrive_stop((st->>'id')::uuid);
        tim := tim || jsonb_build_array(jsonb_build_array('arrive_stop', extract(epoch from clock_timestamp() - t0) * 1000));
        perform set_config('role', 'none', true);
        if random() < p_fail_pickup then
          -- MODELLED: the rider waited 25 minutes
          update route_stops set arrived_at = now() - interval '25 minutes' where id = (st->>'id')::uuid;
          perform set_config('role', 'authenticated', true);
          perform fail_pickup((st->>'id')::uuid, 'Parcel not ready');
          perform set_config('request.jwt.claims', json_build_object('sub', op, 'role','authenticated')::text, true);
          for oo in select od.id from orders od where od.route_id = rt and od.status = 'failed_pickup' order by length(od.ref), od.ref loop
            perform resolve_failed_pickup(oo.id, case when random() < 0.67 then 'business' else 'rider' end, 'Simulation');
          end loop;
          c := c || jsonb_build_object('failed_pickups', coalesce((c->>'failed_pickups')::int, 0) + 1);
          perform set_config('request.jwt.claims', json_build_object('sub', rid, 'role','authenticated')::text, true);
          continue;
        end if;
        -- MODELLED: minutes the rider waited at the shop
        update route_stops set arrived_at = now() - make_interval(secs => (case when random() < p_long_wait then 15 + random() * 13 else 2 + random() * 8 end) * 60)
        where id = (st->>'id')::uuid;
        perform set_config('request.jwt.claims', json_build_object('sub', own[array_position(biz, (select business_id from route_stops where id = (st->>'id')::uuid))], 'role','authenticated')::text, true);
        perform set_config('role', 'authenticated', true);
        select p->>'code' into code from jsonb_array_elements(owner_pickups()) p where p->>'stop_id' = st->>'id';
        perform set_config('request.jwt.claims', json_build_object('sub', rid, 'role','authenticated')::text, true);
        if random() < p_wrong_pick then
          j := confirm_pickup((st->>'id')::uuid, '000001', (st->'business'->>'bags')::int, 'sim/bags.jpg');
          c := c || jsonb_build_object('wrong_codes', coalesce((c->>'wrong_codes')::int, 0) + 1);
        end if;
        t0 := clock_timestamp(); j := confirm_pickup((st->>'id')::uuid, code, (st->'business'->>'bags')::int, 'sim/bags.jpg');
        tim := tim || jsonb_build_array(jsonb_build_array('confirm_pickup', extract(epoch from clock_timestamp() - t0) * 1000));
        if not coalesce((j->>'ok')::boolean, false) then c := c || jsonb_build_object('pickup_refused', coalesce((c->>'pickup_refused')::int, 0) + 1); end if;
      end loop;

      -- rider change mid-trip
      perform set_config('role', 'none', true);
      if random() < p_change and exists (select 1 from orders od where od.route_id = rt and od.status = 'out_for_delivery') then
        perform set_config('request.jwt.claims', json_build_object('sub', op, 'role','authenticated')::text, true);
        perform set_config('role', 'authenticated', true);
        select a.rider_id into newr from available_riders((select v.type from routes rx join vehicles v on v.id = rx.vehicle_id where rx.id = rt), 1) a
          where a.rider_id = any(rds) order by a.full_name limit 1;
        if newr is not null then
          t0 := clock_timestamp(); o := change_rider(rt, newr, 'Vehicle breakdown');
          tim := tim || jsonb_build_array(jsonb_build_array('change_rider', extract(epoch from clock_timestamp() - t0) * 1000));
          perform set_config('request.jwt.claims', json_build_object('sub', rid, 'role','authenticated')::text, true);
          code := rider_route()->'handover_out'->>'code';
          perform set_config('request.jwt.claims', json_build_object('sub', newr, 'role','authenticated')::text, true);
          select (s->>'id') into e from jsonb_array_elements(rider_route()->'stops') s where s->>'kind' = 'handover';
          j := accept_handover(e::uuid, code, 'sim/handover.jpg');
          c := c || jsonb_build_object('rider_changes', coalesce((c->>'rider_changes')::int, 0) + 1);
          rid := newr;
        end if;
        perform set_config('request.jwt.claims', json_build_object('sub', rid, 'role','authenticated')::text, true);
      end if;

      -- drops
      perform set_config('role', 'none', true);
      for oo in select od.id, od.customer_id, od.window_start, od.window_end, od.business_id from orders od
                where od.rider_id = rid and od.status = 'out_for_delivery' and od.business_id = any(biz) order by length(od.ref), od.ref loop
        perform set_config('request.jwt.claims', json_build_object('sub', rid, 'role','authenticated')::text, true);
        perform set_config('role', 'authenticated', true);
        if random() < p_fail_drop then
          perform fail_delivery(oo.id, 'Customer not home');
          perform set_config('request.jwt.claims', json_build_object('sub', op, 'role','authenticated')::text, true);
          perform resolve_failed_delivery(oo.id, case when random() < 0.6 then 'customer' else 'ona' end, 'Simulation');
          c := c || jsonb_build_object('failed_deliveries', coalesce((c->>'failed_deliveries')::int, 0) + 1);
          perform set_config('role', 'none', true);
          continue;
        end if;
        rn := random();
        if rn < p_delay then
          perform report_delay(oo.id, oo.window_end + make_interval(mins => (20 + floor(random() * 50))::int), 'Heavy traffic');
          c := c || jsonb_build_object('traffic_notices', coalesce((c->>'traffic_notices')::int, 0) + 1);
        end if;
        code := null;
        if oo.customer_id is not null then
          perform set_config('request.jwt.claims', json_build_object('sub', oo.customer_id, 'role','authenticated')::text, true);
          t0 := clock_timestamp(); code := order_tracking(oo.id)->>'delivery_code';
          tim := tim || jsonb_build_array(jsonb_build_array('order_tracking', extract(epoch from clock_timestamp() - t0) * 1000));
        end if;
        perform set_config('request.jwt.claims', json_build_object('sub', rid, 'role','authenticated')::text, true);
        if code is null or random() < p_lockout then
          if code is not null then
            for k in 1..5 loop j := deliver_order(oo.id, '000002', 'sim/door.jpg'); end loop;
            c := c || jsonb_build_object('codes_locked', coalesce((c->>'codes_locked')::int, 0) + 1)
                   || jsonb_build_object('wrong_codes', coalesce((c->>'wrong_codes')::int, 0) + 5);
          else
            c := c || jsonb_build_object('no_app_customer', coalesce((c->>'no_app_customer')::int, 0) + 1);
          end if;
          perform set_config('request.jwt.claims', json_build_object('sub', op, 'role','authenticated')::text, true);
          t0 := clock_timestamp(); perform override_delivery(oo.id, 'Phoned the customer, confirmed name and items');
          tim := tim || jsonb_build_array(jsonb_build_array('override_delivery', extract(epoch from clock_timestamp() - t0) * 1000));
          c := c || jsonb_build_object('overrides', coalesce((c->>'overrides')::int, 0) + 1);
        else
          if random() < p_wrong_once then
            j := deliver_order(oo.id, '000003', 'sim/door.jpg');
            c := c || jsonb_build_object('wrong_codes', coalesce((c->>'wrong_codes')::int, 0) + 1);
          end if;
          t0 := clock_timestamp(); j := deliver_order(oo.id, code, 'sim/door.jpg');
          tim := tim || jsonb_build_array(jsonb_build_array('deliver_order', extract(epoch from clock_timestamp() - t0) * 1000));
          if not coalesce((j->>'ok')::boolean, false) then c := c || jsonb_build_object('right_code_refused', coalesce((c->>'right_code_refused')::int, 0) + 1); end if;
        end if;
        perform set_config('role', 'none', true);
        -- MODELLED: when the parcel was handed over
        update orders set delivered_at = case
            when rn < p_delay then eta
            when rn < p_delay + p_late_quiet then window_end + make_interval(mins => (10 + floor(random() * 30))::int)
            else window_start + (window_end - window_start) * (0.1 + random() * 0.85) end
        where id = oo.id and status = 'delivered';
      end loop;
      perform set_config('role', 'none', true);
    end loop;

    -- 6. privacy probes: each role tries to read what it must not (every row counted is a leak)
    leak := 0;
    perform set_config('request.jwt.claims', json_build_object('sub', own[1], 'role','authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    leak := leak + (select count(*) from orders where business_id <> biz[1]) + (select count(*) from products where business_id <> biz[1])
                 + (select count(*) from profiles where role = 'customer');
    perform set_config('request.jwt.claims', json_build_object('sub', sa, 'role','authenticated')::text, true);
    leak := leak + (select count(*) from orders) + (select count(*) from order_items) + (select count(*) from products);
    perform set_config('request.jwt.claims', json_build_object('sub', op, 'role','authenticated')::text, true);
    leak := leak + (select count(*) from payments) + (select count(*) from order_charges) + (select count(*) from order_items) + (select count(*) from products);
    leak := leak + case when admin_overview() is null then 0 else 1 end;
    perform set_config('request.jwt.claims', json_build_object('sub', rds[1], 'role','authenticated')::text, true);
    leak := leak + (select count(*) from orders) + (select count(*) from codes) + (select count(*) from route_stops) + (select count(*) from payments);
    perform set_config('request.jwt.claims', json_build_object('sub', cust_id[1], 'role','authenticated')::text, true);
    leak := leak + (select count(*) from orders where customer_id is distinct from cust_id[1]) + (select count(*) from order_charges);
    perform set_config('role', 'none', true);
    c := c || jsonb_build_object('privacy_probes', coalesce((c->>'privacy_probes')::int, 0) + 17, 'privacy_leaks', coalesce((c->>'privacy_leaks')::int, 0) + leak);
  end loop;

  -- ------------------------------------------------ after delivery: ratings, claims
  for oo in select od.id, od.customer_id, od.business_id from orders od where od.business_id = any(biz) and od.status = 'delivered' order by length(od.ref), od.ref loop
    if oo.customer_id is not null and random() < p_rate then
      perform set_config('request.jwt.claims', json_build_object('sub', oo.customer_id, 'role','authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      perform rate_order(oo.id, (array[3,4,4,5,5,5])[1 + floor(random() * 6)::int], null);
      perform set_config('role', 'none', true);
    end if;
    rn := random();
    if rn < p_claim then
      perform set_config('request.jwt.claims', json_build_object('sub', own[array_position(biz, oo.business_id)], 'role','authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      cl := open_claim(oo.id, 'damage', round((5000 + random() * 145000)::numeric, -2), 'Damaged at the door (simulation)');
      perform set_config('request.jwt.claims', json_build_object('sub', op, 'role','authenticated')::text, true);
      rn := random();
      perform decide_claim(cl, case when rn < 0.5 then 'rider' when rn < 0.8 then 'store' else 'unclear' end::claim_cause, rn < 0.5, 'Decided from the pickup and door photos (simulation)');
      if rn < 0.5 then
        perform set_config('request.jwt.claims', json_build_object('sub', sa, 'role','authenticated')::text, true);
        perform mark_claim_paid(cl, 'SIM-REFUND');
      end if;
      perform set_config('role', 'none', true);
    elsif rn < p_claim + p_late_claim then
      update orders set delivered_at = now() - interval '30 hours' where id = oo.id;   -- MODELLED: 30 hours later
      perform set_config('request.jwt.claims', json_build_object('sub', own[array_position(biz, oo.business_id)], 'role','authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
      c := c || jsonb_build_object('late_claims_tried', coalesce((c->>'late_claims_tried')::int, 0) + 1);
      begin perform open_claim(oo.id, 'missing', 5000, 'Item missing (simulation)');
      exception when others then c := c || jsonb_build_object('late_claims_refused', coalesce((c->>'late_claims_refused')::int, 0) + 1); end;
      perform set_config('role', 'none', true);
    end if;
  end loop;

  -- ------------------------------------------------ results (read as the database owner)
  select jsonb_build_object(
    'seed', 0.2026, 'waves', w, 'runtime_s', round(extract(epoch from clock_timestamp() - t_start)::numeric, 2),
    'counters', c,
    'final_status', (select jsonb_object_agg(status, n) from (select status, count(*) n from orders where business_id = any(biz) group by status) s),
    'orders_unsettled', (select count(*) from orders where business_id = any(biz) and status not in ('delivered','cancelled','returned','claim_open')),
    'events', (select count(*) from order_events e join orders od on od.id = e.order_id where od.business_id = any(biz)),
    'events_without_actor', (select count(*) from order_events e join orders od on od.id = e.order_id where od.business_id = any(biz) and e.by_user is null and e.by_role is null),
    'events_off_transition_table', (select count(*) from order_events e join orders od on od.id = e.order_id where od.business_id = any(biz) and e.from_status is not null
                                     and not exists (select 1 from order_transitions t where t.from_status = e.from_status and t.to_status = e.to_status)),
    'requests', (select jsonb_object_agg(status, n) from (select status, count(*) n from dispatch_requests where business_id = any(biz) group by status) s),
    'receipts', (select jsonb_build_object('submitted', count(*), 'confirmed', count(*) filter (where status = 'confirmed'), 'rejected', count(*) filter (where status = 'rejected'),
                   'median_minutes_to_confirm', percentile_cont(0.5) within group (order by extract(epoch from decided_at - created_at) / 60) filter (where status = 'confirmed'))
                 from payments where business_id = any(biz)),
    'money', jsonb_build_object(
       'fee_revenue', (select coalesce(sum(amount), 0) from payments where business_id = any(biz) and status = 'confirmed'),
       'fees_on_delivered', (select coalesce(sum(ch.fee), 0) from order_charges ch join orders od on od.id = ch.order_id where od.business_id = any(biz) and od.status in ('delivered','claim_open')),
       'waiting_charges', (select coalesce(sum(amount), 0) from business_adjustments where business_id = any(biz) and kind = 'waiting_charge'),
       'waiting_charge_stops', (select count(*) from route_stops s join routes r on r.id = s.route_id where r.rider_id = any(rds) and s.waiting_charge > 0),
       'credits_issued', (select coalesce(-sum(amount), 0) from business_adjustments where business_id = any(biz) and kind = 'credit' and reason like 'Fee returned%'),
       'confirmed_requests_unbalanced', (select count(*) from dispatch_requests q where q.business_id = any(biz) and q.status = 'confirmed' and q.amount_due > 0
                                          and q.amount_due <> coalesce((select sum(p.amount) from payments p where p.request_id = q.id and p.status = 'confirmed'), 0))),
    'stock_mismatches', (select count(*) from products p where p.business_id = any(biz) and (
         p.on_hand <> (select coalesce(sum(m.qty), 0) from stock_movements m where m.product_id = p.id and m.kind in ('stock_in','adjust','dispatch'))
      or p.reserved <> (select coalesce(sum(oi.qty), 0) from order_items oi join orders od on od.id = oi.order_id where oi.product_id = p.id
                         and od.status in ('awaiting_address','received','waiting_restock','packed','awaiting_payment','payment_check','payment_rejected','ready_for_pickup','rider_assigned','rider_at_shop')))),
    'dispatch', jsonb_build_object(
       'routes', (select count(*) from routes where rider_id = any(rds)),
       'routes_done', (select count(*) from routes where rider_id = any(rds) and status = 'done'),
       'drops_per_route', (select round(avg(n), 2) from (select count(*) n from route_stops s join routes r on r.id = s.route_id where r.rider_id = any(rds) and s.kind = 'drop' group by r.id) z),
       'riders_left_on_trip', (select count(*) from riders where profile_id = any(rds) and availability = 'on_trip')),
    'codes', jsonb_build_object(
       'generated', (select count(*) from codes cd left join orders od on od.id = cd.order_id left join route_stops s on s.id = cd.stop_id left join routes r on r.id = s.route_id
                      where od.business_id = any(biz) or r.rider_id = any(rds)),
       'stored_in_plain_text', (select count(*) from codes where code_hash ~ '^\d{6}$'),
       'locked', (select count(*) from codes cd join orders od on od.id = cd.order_id where od.business_id = any(biz) and cd.locked_at is not null)),
    'deliveries', (select jsonb_build_object(
       'delivered', count(*) filter (where delivered_at is not null),
       'on_time', count(*) filter (where delivered_at <= window_end),
       'late_with_traffic_notice', count(*) filter (where delivered_at > window_end and late_reason is not null),
       'late_without_notice', count(*) filter (where delivered_at > window_end and late_reason is null))
       from orders where business_id = any(biz) and status in ('delivered','claim_open')),
    'claims', (select jsonb_build_object('opened', count(*), 'capped_at_limit', count(*) filter (where claimed_value = 100000),
       'rider_paid', count(*) filter (where status = 'paid'), 'store', count(*) filter (where cause = 'store'), 'unclear_rejected', count(*) filter (where cause = 'unclear'),
       'paid_total', coalesce(sum(payout) filter (where status = 'paid'), 0)) from claims where business_id = any(biz)),
    'ratings', (select jsonb_build_object('n', count(*), 'mean', round(avg(f.rating), 2)) from order_feedback f join orders od on od.id = f.order_id where od.business_id = any(biz)),
    'notifications', (select count(*) from notifications n join profiles p on p.id = n.user_id where p.id = any(own || rds || cust_id || array[sa, op])),
    'notifications_flagged_for_email', (select count(*) from notifications n where n.send_email and n.user_id = any(own || rds || cust_id || array[sa, op])),
    'notifications_by_role', (select jsonb_object_agg(role, n) from (select p.role, count(*) n from notifications x join profiles p on p.id = x.user_id
                              where p.id = any(own || rds || cust_id || array[sa, op]) group by p.role) z),
    'issues', (select jsonb_object_agg(kind, n) from (select kind, count(*) n from issues where business_id = any(biz) group by kind) s),
    'timings_ms', (select jsonb_object_agg(f, jsonb_build_object('n', n, 'mean', mean, 'p50', p50, 'p95', p95, 'max', mx)) from (
       select v->>0 f, count(*) n, round(avg((v->>1)::numeric), 2) mean,
              round(percentile_cont(0.5) within group (order by (v->>1)::numeric)::numeric, 2) p50,
              round(percentile_cont(0.95) within group (order by (v->>1)::numeric)::numeric, 2) p95,
              round(max((v->>1)::numeric), 2) mx
       from jsonb_array_elements(tim) v group by 1) t)
  ) into rep;
  raise exception 'SIM_REPORT %', rep;
end $sim$;
