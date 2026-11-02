-- A customer sees the businesses that sent them orders (name and phone on the tracking page), and no others.
create policy businesses_customer on businesses for select
  using (has_role('customer') and exists (select 1 from orders o where o.business_id = businesses.id and o.customer_id = auth.uid()));
