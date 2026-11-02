-- Customers give a phone number at sign-up (the rider calls it at the door).
-- It arrives in user metadata; staff, owners and riders still get theirs from app metadata.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
        r app_role := coalesce(nullif(m->>'ona_role','')::app_role, 'customer');
begin
  insert into profiles (id, email, full_name, phone, role, business_id, ops_lead, must_change_password)
  values (new.id, lower(new.email),
          coalesce(new.raw_user_meta_data->>'full_name', ''),
          case when r = 'customer' then nullif(left(trim(new.raw_user_meta_data->>'phone'), 20), '') else nullif(m->>'phone','') end,
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
revoke execute on function handle_new_user() from public, anon, authenticated;
