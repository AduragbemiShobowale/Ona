-- Supabase grants execute on new functions to anon and authenticated directly.
-- Internal helpers must only run from inside other functions and triggers.
revoke execute on function audit(text,text,text,text,jsonb,jsonb) from public, anon, authenticated;
revoke execute on function audit_trigger() from public, anon, authenticated;
revoke execute on function handle_new_user() from public, anon, authenticated;
