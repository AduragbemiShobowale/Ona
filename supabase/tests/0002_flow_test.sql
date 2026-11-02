-- Full order flow across all five roles, with the privacy rules checked along the way.
-- Runs as one block and always rolls back: the last line raises 'ALL FLOW TESTS PASSED' on success.
do $$
declare
  sa uuid := gen_random_uuid(); op uuid := gen_random_uuid(); oa uuid := gen_random_uuid(); ob uuid := gen_random_uuid();
  rd uuid := gen_random_uuid(); rd2 uuid := gen_random_uuid(); cu uuid := gen_random_uuid(); cu2 uuid := gen_random_uuid();
  ba uuid; bb uuid; v1 uuid; v2 uuid; p1 uuid; p2 uuid; ord uuid; ord2 uuid; oref text; oref2 text; w timestamptz; w2 timestamptz;
  req uuid; pay uuid; rt uuid; rt2 uuid; pstop uuid; hstop uuid; code text; j jsonb; n int; ok boolean; cl uuid; i int;
begin
  insert into businesses (name, zone, pickup_lat, pickup_lng) values ('Flow Shop A', 'Lekki', 6.4474, 3.4721) returning id into ba;
  insert into businesses (name, zone) values ('Flow Shop B', 'Yaba') returning id into bb;
  insert into auth.users (id, email, raw_app_meta_data, email_confirmed_at) values
    (sa, 'f-sa@ona.test', '{"ona_role":"super_admin"}', now()),
    (op, 'f-op@ona.test', '{"ona_role":"operations"}', now()),
    (oa, 'f-oa@ona.test', jsonb_build_object('ona_role','owner','business_id',ba), now()),
    (ob, 'f-ob@ona.test', jsonb_build_object('ona_role','owner','business_id',bb), now()),
    (rd, 'f-rd@ona.test', '{"ona_role":"rider","zone":"Lekki"}', now()),
    (rd2, 'f-rd2@ona.test', '{"ona_role":"rider","zone":"Lekki"}', now()),
    (cu2, 'f-cu2@ona.test', '{}', now());
  select w_start into w from slot_windows(current_date + 3) order by 1 limit 1;
  select w_start into w2 from slot_windows(current_date + 3) order by 1 offset 1 limit 1;

  -- ---------- Operations sets up the fleet
  perform set_config('request.jwt.claims', json_build_object('sub', op, 'role','authenticated')::text, true);
  set local role authenticated;
  v1 := create_vehicle('bike', 'FLW 001', 4); v2 := create_vehicle('car', 'FLW 002', 8);
  perform attach_vehicle(rd, v1); perform attach_vehicle(rd2, v2);
  reset role;

  -- ---------- owner A: stock, then an order to an e-mail with no account yet
  perform set_config('request.jwt.claims', json_build_object('sub', oa, 'role','authenticated')::text, true);
  set local role authenticated;
  p1 := save_product(null, 'ank-01', 'Ankara fabric, 6 yards', 'small', 12000, 2);
  p2 := save_product(null, 'lace-02', 'Lace bundle', 'medium', 30000, 1);
  perform move_stock(p1, 'stock_in', 10, 'Delivery from supplier');
  perform move_stock(p2, 'stock_in', 2, null);
  ok := false; begin perform move_stock(p1, 'adjust', -1, ''); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: adjustment without a reason allowed'; end if;
  ok := false; begin perform send_order('kemi@ona.test', 'Kemi', jsonb_build_array(jsonb_build_object('product_id', p2, 'qty', 3)), w, 'Ikoyi'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: ordered more than in stock'; end if;
  ok := false; begin perform send_order('kemi@ona.test', 'Kemi', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1)), now() + interval '30 minutes', 'Ikoyi'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: window inside the payment cutoff allowed'; end if;
  oref := send_order('Kemi@ona.test', 'Kemi', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 2), jsonb_build_object('product_id', p2, 'qty', 1)), w, 'Ikoyi');
  select id into ord from orders where ref = oref;
  if (select status from orders where id = ord) <> 'awaiting_address' then raise exception 'FAIL: order without address should await address'; end if;
  if (select reserved from products where id = p1) <> 2 then raise exception 'FAIL: stock not reserved'; end if;
  if (select vehicle_type from orders where id = ord) <> 'car' then raise exception 'FAIL: medium item should suggest a car'; end if;
  if (select fee from order_charges where order_id = ord) <> 3000 then raise exception 'FAIL: fee should be car band 1 (3000), got %', (select fee from order_charges where order_id = ord); end if;
  -- direct status change is refused
  ok := false; begin update orders set status = 'delivered' where id = ord; exception when others then ok := true; end;
  get diagnostics n = row_count;
  if not ok and n > 0 then raise exception 'FAIL: direct status update allowed'; end if;
  ok := false; begin perform owner_set_status(ord, 'packed'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: packed before an address (transition table not enforced)'; end if;
  -- second order with an address, for a customer who already has an account
  oref2 := send_order('f-cu2@ona.test', null, jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1)), w, 'Lekki',
                     '{"address":"5 Admiralty Way, Lekki","phone":"0803 000 0000","lat":6.4500,"lng":3.4800}'::jsonb);
  select id into ord2 from orders where ref = oref2;
  if (select status from orders where id = ord2) <> 'received' then raise exception 'FAIL: order with address should be received'; end if;
  if (select customer_id from orders where id = ord2) <> cu2 then raise exception 'FAIL: existing customer not linked'; end if;
  reset role;
  ok := false; begin update orders set status = 'delivered' where id = ord; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: status changed outside move_order (even as the table owner)'; end if;

  -- ---------- owner B cannot see A's stock, orders or customers
  perform set_config('request.jwt.claims', json_build_object('sub', ob, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from products; if n <> 0 then raise exception 'FAIL: owner B sees A''s stock'; end if;
  select count(*) into n from orders; if n <> 0 then raise exception 'FAIL: owner B sees A''s orders'; end if;
  select count(*) into n from business_customers; if n <> 0 then raise exception 'FAIL: owner B sees A''s customers'; end if;
  ok := false; begin perform set_order_address(ord, '{"address":"hijack street 1"}'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: owner B changed A''s order'; end if;
  select count(*) into n from profiles where role = 'customer'; if n <> 0 then raise exception 'FAIL: owner can search customers'; end if;
  reset role;

  -- ---------- the customer signs up later and finds the order waiting
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values (cu, 'kemi@ona.test', now(), '{"full_name":"Kemi A","phone":"0803 111 2222"}');
  perform set_config('request.jwt.claims', json_build_object('sub', cu, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from orders; if n <> 0 then raise exception 'FAIL: customer sees orders before linking'; end if;
  if link_my_orders() <> 1 then raise exception 'FAIL: customer could not pick up their order'; end if;
  select count(*) into n from orders; if n <> 1 then raise exception 'FAIL: customer sees % orders', n; end if;
  perform save_address(null, '{"label":"Home","address":"14 Bourdillon Road, Ikoyi","zone":"Ikoyi","phone":"0803 111 2222"}');
  perform set_order_address(ord, '{"address":"14 Bourdillon Road, Ikoyi","zone":"Ikoyi","phone":"0803 111 2222"}');
  if (select status from orders where id = ord) <> 'received' then raise exception 'FAIL: choosing the address should move to received'; end if;
  select count(*) into n from order_charges; if n <> 0 then raise exception 'FAIL: customer sees delivery fees'; end if;
  reset role;

  -- ---------- owner packs both and requests dispatch with one receipt
  perform set_config('request.jwt.claims', json_build_object('sub', oa, 'role','authenticated')::text, true);
  set local role authenticated;
  perform owner_set_status(ord, 'packed'); perform owner_set_status(ord2, 'packed');
  req := request_dispatch(array[ord, ord2]);
  if (select amount_due from dispatch_requests where id = req) <> (select sum(fee) from order_charges where order_id in (ord, ord2)) then raise exception 'FAIL: amount due wrong'; end if;
  perform submit_payment(req, 'TRF-0001', 'ba/receipt1.jpg', (select amount_due from dispatch_requests where id = req));
  if (select status from orders where id = ord) <> 'payment_check' then raise exception 'FAIL: not in payment check'; end if;
  select id into pay from payments where request_id = req;
  ok := false; begin perform review_payment(pay, true, null); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: owner confirmed their own payment'; end if;
  reset role;

  -- ---------- Operations cannot see money or goods
  perform set_config('request.jwt.claims', json_build_object('sub', op, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from payments; if n <> 0 then raise exception 'FAIL: Operations sees payments'; end if;
  select count(*) into n from order_charges; if n <> 0 then raise exception 'FAIL: Operations sees fees'; end if;
  select count(*) into n from order_items; if n <> 0 then raise exception 'FAIL: Operations sees goods'; end if;
  select count(*) into n from products; if n <> 0 then raise exception 'FAIL: Operations sees stock'; end if;
  if admin_overview() is not null then raise exception 'FAIL: Operations got revenue'; end if;
  ok := false; begin perform review_payment(pay, true, null); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: Operations confirmed a payment'; end if;
  reset role;

  -- ---------- super admin rejects once, then confirms; never sees goods or addresses
  perform set_config('request.jwt.claims', json_build_object('sub', sa, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from orders; if n <> 0 then raise exception 'FAIL: super admin selects orders (addresses)'; end if;
  select count(*) into n from order_items; if n <> 0 then raise exception 'FAIL: super admin sees goods'; end if;
  select count(*) into n from products; if n <> 0 then raise exception 'FAIL: super admin sees stock'; end if;
  select count(*) into n from admin_orders(); if n < 2 then raise exception 'FAIL: admin_orders empty'; end if;
  perform review_payment(pay, false, 'Amount does not match');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', oa, 'role','authenticated')::text, true);
  set local role authenticated;
  if (select status from orders where id = ord) <> 'payment_rejected' then raise exception 'FAIL: rejection not applied'; end if;
  perform submit_payment(req, 'TRF-0002', 'ba/receipt2.jpg', (select amount_due from dispatch_requests where id = req));
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', sa, 'role','authenticated')::text, true);
  set local role authenticated;
  select id into pay from payments where request_id = req and status = 'pending';
  perform review_payment(pay, true, null);
  j := admin_overview(); if (j->>'revenue_today')::numeric <= 0 then raise exception 'FAIL: revenue not counted: %', j->>'revenue_today'; end if;
  reset role;
  if (select status from orders where id = ord) <> 'ready_for_pickup' then raise exception 'FAIL: confirmed order not ready for pickup'; end if;
  if not exists (select 1 from codes where order_id = ord and kind = 'delivery') then raise exception 'FAIL: no delivery code'; end if;
  if exists (select 1 from codes where code_hash ~ '^\d{6}$') then raise exception 'FAIL: a code is stored in plain text'; end if;

  -- ---------- Operations: suggestion, capacity check, route
  perform set_config('request.jwt.claims', json_build_object('sub', op, 'role','authenticated')::text, true);
  set local role authenticated;
  j := suggest_routes(); if jsonb_array_length(j) < 1 then raise exception 'FAIL: no route suggestion'; end if;
  ok := false; begin perform create_route(rd, array[ord, ord2]); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a bike was given an order that needs a car'; end if;
  rt := create_route(rd2, array[ord, ord2], true);
  if (select status from orders where id = ord) <> 'rider_assigned' then raise exception 'FAIL: not assigned'; end if;
  reset role;

  -- ---------- rider: no direct order access; accept, arrive, pickup with code lockout counting
  perform set_config('request.jwt.claims', json_build_object('sub', rd2, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from orders; if n <> 0 then raise exception 'FAIL: rider selects orders directly'; end if;
  select count(*) into n from codes; if n <> 0 then raise exception 'FAIL: rider reads codes'; end if;
  j := rider_route(); if j is null then raise exception 'FAIL: rider has no route'; end if;
  if j::text ~ '"unit_price"|"price"|"fee"' then raise exception 'FAIL: rider route shows money'; end if;
  perform respond_route(rt, true);
  pstop := (select (x->>'id')::uuid from jsonb_array_elements(rider_route()->'stops') x where x->>'kind' = 'pickup' limit 1);
  ok := false; begin perform arrive_stop(pstop, 6.5000, 3.5000); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: check-in far from the shop allowed'; end if;
  perform arrive_stop(pstop, 6.4475, 3.4722);
  j := confirm_pickup(pstop, '000000', 5, 'rd2/bags.jpg');
  if (j->>'ok')::boolean then raise exception 'FAIL: wrong bag count accepted'; end if;
  j := confirm_pickup(pstop, '000000', 2, 'rd2/bags.jpg');
  if (j->>'ok')::boolean then raise exception 'FAIL: wrong pickup code accepted'; end if;
  reset role;
  if (select failed_attempts from codes where stop_id = pstop) <> 1 then raise exception 'FAIL: wrong try not counted'; end if;
  select code_value(id) into code from codes where stop_id = pstop;
  perform set_config('request.jwt.claims', json_build_object('sub', oa, 'role','authenticated')::text, true);
  set local role authenticated;
  j := owner_pickups(); if j->0->>'code' <> code then raise exception 'FAIL: owner does not see the pickup code'; end if;
  if (order_tracking(ord)->>'delivery_code') is not null then raise exception 'FAIL: owner sees the delivery code'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', rd2, 'role','authenticated')::text, true);
  set local role authenticated;
  if rider_route()::text like '%' || code || '%' then raise exception 'FAIL: pickup code on the rider''s screen'; end if;
  j := confirm_pickup(pstop, code, 2, 'rd2/bags.jpg');
  if not (j->>'ok')::boolean then raise exception 'FAIL: right pickup code refused: %', j; end if;
  perform ping_location(6.45, 3.47);
  reset role;
  if (select status from orders where id = ord) <> 'out_for_delivery' then raise exception 'FAIL: not out for delivery'; end if;
  if (select on_hand from products where id = p1) <> 7 or (select reserved from products where id = p1) <> 0 then raise exception 'FAIL: stock not taken out on pickup'; end if;

  -- ---------- customer sees rider and delivery code; delivery code locks after 5 wrong tries
  perform set_config('request.jwt.claims', json_build_object('sub', cu, 'role','authenticated')::text, true);
  set local role authenticated;
  j := order_tracking(ord);
  if j->>'delivery_code' is null or j->'rider'->>'plate' <> 'FLW 002' or j->'location' is null then raise exception 'FAIL: customer tracking incomplete: %', j; end if;
  code := j->>'delivery_code';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', rd2, 'role','authenticated')::text, true);
  set local role authenticated;
  for i in 1..5 loop j := deliver_order(ord, '999999', 'rd2/door.jpg'); end loop;
  j := deliver_order(ord, code, 'rd2/door.jpg');
  if (j->>'ok')::boolean then raise exception 'FAIL: locked code still accepted'; end if;
  -- the second order is delivered normally
  reset role;
  select code_value(id) into code from codes where order_id = ord2 and kind = 'delivery';
  perform set_config('request.jwt.claims', json_build_object('sub', rd2, 'role','authenticated')::text, true);
  set local role authenticated;
  j := deliver_order(ord2, code, 'rd2/door2.jpg');
  if not (j->>'ok')::boolean then raise exception 'FAIL: delivery refused: %', j; end if;
  reset role;

  -- ---------- Operations overrides the locked code after phoning the customer
  perform set_config('request.jwt.claims', json_build_object('sub', op, 'role','authenticated')::text, true);
  set local role authenticated;
  if (ops_overview()->>'codes_locked')::int < 1 then raise exception 'FAIL: locked code not on the ops dashboard'; end if;
  ok := false; begin perform override_delivery(ord, 'ok'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: override without a proper reason'; end if;
  perform override_delivery(ord, 'Called Kemi on 0803 111 2222, confirmed name and items');
  reset role;
  if (select status from orders where id = ord) <> 'delivered' then raise exception 'FAIL: override did not deliver'; end if;
  if (select status from routes where id = rt) <> 'done' then raise exception 'FAIL: route not finished'; end if;
  if (select availability from riders where profile_id = rd2) <> 'available' then raise exception 'FAIL: rider not free again'; end if;

  -- ---------- customer rates; owner claims; Operations decides; super admin pays
  perform set_config('request.jwt.claims', json_build_object('sub', cu, 'role','authenticated')::text, true);
  set local role authenticated;
  perform rate_order(ord, 4, 'Quick, friendly rider');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', oa, 'role','authenticated')::text, true);
  set local role authenticated;
  cl := open_claim(ord, 'damage', 250000, 'Lace bundle torn at the door, intact in the pickup photo');
  if (select claimed_value from claims where id = cl) <> 100000 then raise exception 'FAIL: claim not capped at the limit'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', op, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from claims; if n <> 1 then raise exception 'FAIL: Operations cannot see the claim'; end if;
  ok := false; begin perform decide_claim(cl, 'store', true, 'Torn in the pickup photo already'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: store-caused claim approved for refund'; end if;
  perform decide_claim(cl, 'rider', true, 'Intact in pickup photo, torn at the door: rider-caused');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', sa, 'role','authenticated')::text, true);
  set local role authenticated;
  perform mark_claim_paid(cl, 'TRF-REFUND-1');
  reset role;
  if (select status from claims where id = cl) <> 'paid' then raise exception 'FAIL: claim not paid'; end if;

  -- ---------- late claim refused
  update orders set delivered_at = now() - interval '30 hours' where id = ord2;
  perform set_config('request.jwt.claims', json_build_object('sub', oa, 'role','authenticated')::text, true);
  set local role authenticated;
  ok := false; begin perform open_claim(ord2, 'missing', 5000, 'One item missing from the bag'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: missing-item claim after 24 h allowed'; end if;
  reset role;

  -- ---------- rider change mid-trip with a handover code
  perform set_config('request.jwt.claims', json_build_object('sub', oa, 'role','authenticated')::text, true);
  set local role authenticated;
  oref := send_order('f-cu2@ona.test', null, jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1)), w2, 'Lekki', '{"address":"7 Admiralty Way, Lekki"}'::jsonb);
  select id into ord from orders where ref = oref;
  perform owner_set_status(ord, 'packed');
  req := request_dispatch(array[ord]);
  perform submit_payment(req, 'TRF-0003', 'ba/receipt3.jpg', 1500);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', sa, 'role','authenticated')::text, true);
  set local role authenticated;
  perform review_payment((select id from payments where request_id = req), true, null);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', op, 'role','authenticated')::text, true);
  set local role authenticated;
  rt := create_route(rd, array[ord]);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', rd, 'role','authenticated')::text, true);
  set local role authenticated;
  perform respond_route(rt, true);
  pstop := (select (x->>'id')::uuid from jsonb_array_elements(rider_route()->'stops') x where x->>'kind' = 'pickup' limit 1);
  perform arrive_stop(pstop);
  reset role;
  select code_value(id) into code from codes where stop_id = pstop;
  perform set_config('request.jwt.claims', json_build_object('sub', rd, 'role','authenticated')::text, true);
  set local role authenticated;
  j := confirm_pickup(pstop, code, 1, 'rd/bags.jpg');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', op, 'role','authenticated')::text, true);
  set local role authenticated;
  rt2 := change_rider(rt, rd2, 'Vehicle breakdown');
  reset role;
  if (select status from orders where id = ord) <> 'rider_changing' then raise exception 'FAIL: not rider_changing'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', rd, 'role','authenticated')::text, true);
  set local role authenticated;
  code := rider_route()->'handover_out'->>'code';
  if code is null then raise exception 'FAIL: outgoing rider has no handover code'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', rd2, 'role','authenticated')::text, true);
  set local role authenticated;
  hstop := (select (x->>'id')::uuid from jsonb_array_elements(rider_route()->'stops') x where x->>'kind' = 'handover' limit 1);
  j := accept_handover(hstop, code, 'rd2/handover.jpg');
  if not (j->>'ok')::boolean then raise exception 'FAIL: handover refused: %', j; end if;
  reset role;
  if (select status from orders where id = ord) <> 'out_for_delivery' or (select rider_id from orders where id = ord) <> rd2 then raise exception 'FAIL: handover not applied'; end if;
  if (select status from routes where id = rt) <> 'done' then raise exception 'FAIL: old route not closed after handover'; end if;

  -- ---------- cancelling a paid order before pickup gives credit, applied on the next request
  perform set_config('request.jwt.claims', json_build_object('sub', oa, 'role','authenticated')::text, true);
  set local role authenticated;
  oref := send_order('f-cu2@ona.test', null, jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1)), w2, 'Lekki', '{"address":"9 Admiralty Way, Lekki"}'::jsonb);
  select id into ord from orders where ref = oref;
  perform owner_set_status(ord, 'packed');
  req := request_dispatch(array[ord]);
  perform submit_payment(req, 'TRF-0004', 'ba/receipt4.jpg', 1500);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', sa, 'role','authenticated')::text, true);
  set local role authenticated;
  perform review_payment((select id from payments where request_id = req), true, null);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', oa, 'role','authenticated')::text, true);
  set local role authenticated;
  perform owner_set_status(ord, 'cancelled', 'Customer changed their mind');
  if (owner_overview()->>'balance')::numeric >= 0 then raise exception 'FAIL: no credit after cancelling a paid order'; end if;
  reset role;

  raise exception 'ALL FLOW TESTS PASSED';
end $$;
