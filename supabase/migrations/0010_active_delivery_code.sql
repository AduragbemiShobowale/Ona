-- The rider's delivery-code check uses the order's active code (not used, newest first).
-- Found by the 200-order simulation: an order dispatched again after a business-caused failed pickup
-- has an old, cancelled code and a new one. Choosing by creation time alone could pick the old code
-- when both were created at the same moment, refusing the right code.
create or replace function deliver_order(p_order uuid, p_code text, p_photo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o orders; c uuid; res text;
begin
  select * into o from orders where id = p_order and rider_id = auth.uid() for update;
  if o.id is null or o.status <> 'out_for_delivery' then raise exception 'This order is not out for delivery with you.'; end if;
  if coalesce(p_photo,'') = '' then raise exception 'Photograph the handover first.'; end if;
  select id into c from codes where order_id = o.id and kind = 'delivery' order by (used_at is null) desc, created_at desc limit 1;
  res := check_code(c, p_code);
  if res <> 'ok' then return code_message(res); end if;
  perform complete_delivery(o.id, p_photo, 'Delivered with code');
  return jsonb_build_object('ok', true);
end $$;
