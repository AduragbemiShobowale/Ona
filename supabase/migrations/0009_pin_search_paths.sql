-- Pin the search path on the small helper functions (Supabase security advisor).
alter function distance_km(numeric,numeric,numeric,numeric) set search_path = public;
alter function suggest_vehicle(size_class,int) set search_path = public;
alter function code_message(text) set search_path = public;
alter function vehicle_rank(vehicle_type) set search_path = public;
