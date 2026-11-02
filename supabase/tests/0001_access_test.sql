-- Access tests for phase 1. Runs as one block and always rolls back:
-- the last line raises 'ALL ACCESS TESTS PASSED' on success, or the first failure.
-- Safe on the live project (nothing is kept).
do $$
declare
  sa uuid := gen_random_uuid(); opl uuid := gen_random_uuid(); opd uuid := gen_random_uuid();
  oa uuid := gen_random_uuid(); ob uuid := gen_random_uuid(); rd uuid := gen_random_uuid(); rd2 uuid := gen_random_uuid();
  cu uuid := gen_random_uuid(); sneaky uuid := gen_random_uuid();
  ba uuid; bb uuid; v1 uuid; n int; ok boolean; j jsonb;
  procedure_as text;
begin
  insert into businesses (name) values ('Test Boutique A') returning id into ba;
  insert into businesses (name) values ('Test Bakery B') returning id into bb;
  insert into auth.users (id, email, raw_app_meta_data, email_confirmed_at) values
    (sa,  't-sa@ona.test',  '{"ona_role":"super_admin"}', now()),
    (opl, 't-opl@ona.test', '{"ona_role":"operations","ops_lead":true}', now()),
    (opd, 't-opd@ona.test', '{"ona_role":"operations"}', now()),
    (oa,  't-oa@ona.test',  jsonb_build_object('ona_role','owner','business_id',ba), now()),
    (ob,  't-ob@ona.test',  jsonb_build_object('ona_role','owner','business_id',bb), now()),
    (rd,  't-rd@ona.test',  '{"ona_role":"rider","zone":"Lekki","must_change_password":true}', now()),
    (rd2, 't-rd2@ona.test', '{"ona_role":"rider"}', now()),
    (cu,  't-cu@ona.test',  '{}', now());
  -- a self-signup cannot pick its role through user metadata
  insert into auth.users (id, email, raw_user_meta_data) values (sneaky, 't-sneaky@ona.test', '{"ona_role":"super_admin","full_name":"Sneaky","phone":"0803 555 0100"}');

  -- trigger created the right profiles
  if (select role from profiles where id = cu) <> 'customer' then raise exception 'FAIL: plain signup should be customer'; end if;
  if (select role from profiles where id = sneaky) <> 'customer' then raise exception 'FAIL: user metadata must not set the role'; end if;
  if (select phone from profiles where id = sneaky) is distinct from '0803 555 0100' then raise exception 'FAIL: customer phone not saved'; end if;
  if (select business_id from profiles where id = oa) <> ba then raise exception 'FAIL: owner not linked to business'; end if;
  if not exists (select 1 from riders where profile_id = rd and zone = 'Lekki') then raise exception 'FAIL: rider row missing'; end if;
  if not (select must_change_password from profiles where id = rd) then raise exception 'FAIL: must_change_password not set'; end if;

  -- ---------- customer
  perform set_config('request.jwt.claims', json_build_object('sub', cu, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from profiles; if n <> 1 then raise exception 'FAIL: customer sees % profiles', n; end if;
  select count(*) into n from businesses; if n <> 0 then raise exception 'FAIL: customer sees businesses'; end if;
  select count(*) into n from riders; if n <> 0 then raise exception 'FAIL: customer sees riders'; end if;
  if platform_counts() is not null then raise exception 'FAIL: customer got platform counts'; end if;
  j := my_account(); if (j->'profile'->>'role') <> 'customer' or not (j->>'email_confirmed')::boolean then raise exception 'FAIL: my_account for customer'; end if;
  reset role;

  -- ---------- owner A
  perform set_config('request.jwt.claims', json_build_object('sub', oa, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from businesses; if n <> 1 then raise exception 'FAIL: owner sees % businesses', n; end if;
  if not exists (select 1 from businesses where id = ba) then raise exception 'FAIL: owner cannot see own business'; end if;
  select count(*) into n from profiles; if n <> 1 then raise exception 'FAIL: owner sees other profiles'; end if;
  update businesses set name = 'Hacked' where id = bb; get diagnostics n = row_count; if n <> 0 then raise exception 'FAIL: owner updated another business'; end if;
  update businesses set name = 'Hacked' where id = ba; get diagnostics n = row_count; if n <> 0 then raise exception 'FAIL: direct update allowed'; end if;
  ok := false; begin perform update_business(bb, '{"name":"Hacked"}'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: owner changed another business via function'; end if;
  perform update_business(ba, '{"pickup_landmark":"by the bank"}');
  ok := false; begin perform create_vehicle('bike','XX 1','2'::int); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: owner created a vehicle'; end if;
  ok := false; begin perform audit('x','1','forged',null,null,null); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: a user can write the audit log directly'; end if;
  ok := false; begin perform set_setting('waiting_rate','999'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: owner changed a setting'; end if;
  reset role;

  -- ---------- super admin
  perform set_config('request.jwt.claims', json_build_object('sub', sa, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from profiles where role = 'customer'; if n <> 0 then raise exception 'FAIL: super admin can list customers'; end if;
  j := platform_counts(); if (j->>'customers')::int < 2 then raise exception 'FAIL: customer count wrong %', j; end if;
  select count(*) into n from businesses where id in (ba, bb); if n <> 2 then raise exception 'FAIL: super admin cannot see businesses'; end if;
  perform set_setting('waiting_rate','250');
  ok := false; begin perform create_vehicle('bike','XX 1',2); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: super admin should not create vehicles (Operations does)'; end if;
  select count(*) into n from audit_log where entity = 'settings'; if n < 1 then raise exception 'FAIL: setting change not audited'; end if;
  reset role;

  -- ---------- operations
  perform set_config('request.jwt.claims', json_build_object('sub', opd, 'role','authenticated')::text, true);
  set local role authenticated;
  v1 := create_vehicle('bike','lag 123 xy',3);
  if (select plate from vehicles where id = v1) <> 'LAG 123 XY' then raise exception 'FAIL: plate not normalised'; end if;
  ok := false; begin perform create_vehicle('bike','LAG 123 XY',3); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: duplicate plate allowed'; end if;
  perform attach_vehicle(rd, v1);
  ok := false; begin perform attach_vehicle(rd2, v1); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: one vehicle attached to two riders'; end if;
  select count(*) into n from audit_log; if n <> 0 then raise exception 'FAIL: dispatch staff (not lead) can read audit'; end if;
  select count(*) into n from profiles where role = 'customer'; if n <> 0 then raise exception 'FAIL: operations can list customers'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', opl, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from audit_log; if n = 0 then raise exception 'FAIL: ops lead cannot read audit'; end if;
  reset role;

  -- ---------- rider
  perform set_config('request.jwt.claims', json_build_object('sub', rd, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from riders; if n <> 1 then raise exception 'FAIL: rider sees % rider rows', n; end if;
  select count(*) into n from vehicles; if n <> 1 then raise exception 'FAIL: rider sees % vehicles', n; end if;
  perform set_my_availability(false);
  if (select availability from riders where profile_id = rd) <> 'off' then raise exception 'FAIL: rider could not go off'; end if;
  ok := false; begin perform set_rider(rd2, null, null, 'paused'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL: rider changed another rider'; end if;
  j := my_account(); if (j->'rider'->'vehicle'->>'plate') <> 'LAG 123 XY' then raise exception 'FAIL: my_account rider vehicle'; end if;
  reset role;

  -- ---------- anonymous
  perform set_config('request.jwt.claims', '{}', true);
  set local role anon;
  select count(*) into n from settings; if n <> 0 then raise exception 'FAIL: anon reads settings'; end if;
  reset role;

  raise exception 'ALL ACCESS TESTS PASSED';
end $$;
