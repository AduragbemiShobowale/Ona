-- Removes everything sample_activity.sql added, and puts the existing sample accounts back as they
-- were on 12 November 2026 (no orders; Adùnní Fabrics' stock as it was; rider Emeka with no licence date).
-- Real accounts and settings are not touched. Run as the database owner.
do $clean$
declare
  sample_biz uuid[]; demo_biz uuid; demo_rider uuid; n jsonb;
begin
  select array_agg(b.id) into sample_biz from businesses b
    where exists (select 1 from profiles p where p.business_id = b.id and p.email like '%@sample.ona.invalid');
  select business_id into demo_biz from profiles where email = 'owner@demo.ona.test';
  select id into demo_rider from profiles where email = '2348035550177@rider.ona.invalid';

  -- all delivery activity (before the seed there were no orders, requests, routes or claims)
  delete from rider_locations;
  delete from codes;
  delete from issues;
  delete from claims;
  delete from business_adjustments;
  delete from route_stops;
  delete from order_feedback;
  delete from payments;
  delete from orders;            -- order items, charges and events go with them
  delete from dispatch_requests;
  delete from routes;
  delete from rider_payouts;
  delete from business_customers;
  delete from customer_addresses where customer_id in (select id from profiles where email like '%@sample.ona.invalid' or email = 'customer@demo.ona.test');
  delete from notifications;     -- there were none before the seed

  -- the sample shops, their stock, and every @sample.ona.invalid account (profiles and riders go with them)
  delete from stock_movements where business_id = any(sample_biz) or (business_id = demo_biz and id > 16);
  delete from products where business_id = any(sample_biz);
  delete from auth.users where email like '%@sample.ona.invalid';
  delete from businesses where id = any(sample_biz);
  delete from vehicles where id <> '505e4a7f-4ab0-4f0f-b8f5-92476fb88b32' and id not in (select vehicle_id from riders where vehicle_id is not null)
    and plate like 'LSR %';

  -- the existing sample shop's stock and rider as they were
  update products p set on_hand = v.on_hand, reserved = 0 from (values ('ANK-01', 30), ('LACE-02', 8), ('ASO-03', 5), ('CAP-04', 2)) v(sku, on_hand)
    where p.business_id = demo_biz and p.sku = v.sku;
  update riders set licence_expiry = null, availability = 'available' where profile_id = demo_rider;
  delete from audit_log where id > 46;

  select jsonb_build_object('businesses', (select count(*) from businesses), 'profiles', (select count(*) from profiles),
    'orders', (select count(*) from orders), 'vehicles', (select count(*) from vehicles), 'notifications', (select count(*) from notifications)) into n;
  raise notice 'AFTER_CLEANUP %', n;
end $clean$;
