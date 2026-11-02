# Ọ̀nà

Last-mile delivery for Lagos businesses. Ọ̀nà is the logistics company: it owns the riders and vehicles. Businesses record their stock, create orders, pack them and pay the delivery fee; Ọ̀nà picks up and delivers to their customers. Every handover is confirmed with a code: a **pickup code** from the business to the rider, and a **delivery code** from the customer to the rider.

- Full specification: [`docs/spec.html`](docs/spec.html) (open in a browser)
- Clickable prototype of every role: [`docs/prototype.html`](docs/prototype.html)
- How businesses reach customers without seeing other businesses' customers: [`docs/customer-linkage.html`](docs/customer-linkage.html)

## Roles

| Role | Created by | Does |
| --- | --- | --- |
| Super admin | Setup script | Businesses, Operations staff, fees and slots, confirms payment receipts, revenue (delivery fees only), issues |
| Operations | Super admin | Dispatch queue and combined routes, live trips, waiting and failed pickups, rider changes, code overrides, claims, riders and vehicles, dispatch staff |
| Business owner | Super admin | Stock, single and bulk orders, packing, dispatch requests and receipts, pickup code, feedback, performance |
| Rider | Operations | Routes, arrival check-in, photos, pickup and delivery codes, failed pickups and deliveries, problem reports |
| Customer | Themselves | Chooses the address, tracks the rider, checks items, gives the delivery code, rates, reports problems |

## Stack

React 18 + Vite, Supabase (Postgres, Auth, Storage, Realtime, cron), Vercel. Email through Resend. Maps from OpenStreetMap with Leaflet. The foundation was started from a copy of the author's earlier Verity project (auth, layout, UI kit, spreadsheet parser, idle sign-out, admin-users function) and is being rebuilt for Ọ̀nà.

## Run it

```bash
npm install
cp .env.example .env.local   # then fill in the Supabase URL and publishable key
npm run dev                  # http://localhost:5173
npm test
npm run build
```

## Live

https://ona-one.vercel.app (Vercel project `ona`). Every push to `main` deploys to production automatically; preview deployments stay behind Vercel sign-in.

## Backend

Supabase project `ona` (London, eu-west-2), ref `sezjhdfmgjndnbsjtsjp`. The app's defaults point at it; the URL and publishable key are safe in the browser because access is enforced by row-level security and database functions.

- Migrations: `supabase/migrations/` (applied in order).
- Account creation: `supabase/functions/admin-users` (deployed). New accounts get a temporary password shown once and must change it at first sign-in. Riders without e-mail sign in with their phone number.
- Access tests: `supabase/tests/0001_access_test.sql` runs every privacy rule as each role and always rolls back. Run it on the live project from the SQL editor, or locally on plain Postgres after `supabase/tests/local_stub.sql`. It ends with `ALL ACCESS TESTS PASSED`.

## Build phases

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Foundation: rebrand, five roles, routing, every screen listed with its functions | Done |
| 1 | Database: accounts and roles, businesses, Operations, riders and vehicles, settings, audit, notifications, row-level security, admin-users function, access tests. Screens: Businesses, Staff, Riders & vehicles, phone sign-in for riders | Done |
| 2 | Orders and the transitions table; owner stock ledger, new and bulk orders, customer linkage; customer orders and addresses | Next |
| 3 | Payments: dispatch requests for one or many orders, receipt upload, super admin confirmation, fees, slots, credits, waiting charges | |
| 4 | Dispatch and trips: route suggestions, rider app, arrival and waiting, pickup/handover/delivery codes, photos, live location, traffic notices, rider changes | |
| 5 | Disputes, claims, complaints, dashboards, issues and prompts | |
| 6 | Resend email, sample data for the three study cases with reset, CSV exports, browser tests, deploy | |
