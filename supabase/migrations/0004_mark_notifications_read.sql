-- The bell marks notifications read through this function; it only ever touches the caller's own rows.
create or replace function mark_notifications_read(p_ids bigint[] default null)
returns void language sql security definer set search_path = public as $$
  update notifications set read_at = now()
   where user_id = auth.uid() and read_at is null
     and (p_ids is null or id = any(p_ids));
$$;
revoke execute on function mark_notifications_read(bigint[]) from public, anon;
grant execute on function mark_notifications_read(bigint[]) to authenticated;
