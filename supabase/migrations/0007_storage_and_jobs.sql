-- Private storage for receipts, claim proof and condition photos, and the scheduled jobs.
-- Both depend on Supabase (storage schema, pg_cron); on plain Postgres this migration does nothing.
do $outer$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('receipts', 'receipts', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf']),
           ('photos', 'photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
    on conflict (id) do nothing;

    -- receipts/<business_id>/...: the business uploads and reads its own; the super admin reads all;
    -- Operations reads a file only when it is the proof on a claim.
    execute $p$create policy receipts_upload on storage.objects for insert to authenticated
      with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = public.my_business_id()::text)$p$;
    execute $p$create policy receipts_read on storage.objects for select to authenticated
      using (bucket_id = 'receipts' and ((storage.foldername(name))[1] = public.my_business_id()::text
             or public.has_role('super_admin')
             or (public.has_role('operations') and exists (select 1 from public.claims c where c.proof_path = name))))$p$;

    -- photos/<rider_id>/...: riders upload their own; staff read all; a business reads photos of its own pickups and drops.
    execute $p$create policy photos_upload on storage.objects for insert to authenticated
      with check (bucket_id = 'photos' and public.has_role('rider') and (storage.foldername(name))[1] = auth.uid()::text)$p$;
    execute $p$create policy photos_read on storage.objects for select to authenticated
      using (bucket_id = 'photos' and ((storage.foldername(name))[1] = auth.uid()::text
             or public.has_role('operations','super_admin')
             or exists (select 1 from public.route_stops s left join public.orders o on o.id = s.order_id
                        where s.photo_path = name and (s.business_id = public.my_business_id() or o.business_id = public.my_business_id()))))$p$;
  end if;

  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('ona-expire-requests', '*/5 * * * *', 'select public.expire_overdue_requests()');
    perform cron.schedule('ona-purge-locations', '17 3 * * *', 'select public.purge_old_locations()');
  end if;
end $outer$;
