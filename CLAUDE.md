# Working on Ọ̀nà

Read `README.md` first. The agreed behaviour is in `docs/spec.html` (v5); when code and spec disagree, the spec wins unless the owner of the repo says otherwise.

## Rules that must hold everywhere

- **Five roles**: `super_admin`, `operations`, `owner`, `rider`, `customer`. Only customers sign themselves up.
- **Enforce access in the database**, never only in the UI: row-level security on every table and a role check in every function (the Verity pattern).
  - The super admin never reads goods value, prices or stock. Revenue means delivery fees and waiting charges only.
  - Operations never reads revenue totals; it sees goods value only on a claim it is handling.
  - A business reaches the customers table only through one server function (`send_order`), which returns an order number and never reveals whether the e-mail already had an account. There is no customer search.
  - A rider sees a customer's address and phone only for an active job.
  - Riders have no earnings screen; rider pay is visible to super admin and Operations only.
- **Status changes** go through one transitions table; anything else is refused. Every change writes an event with who, when and why.
- **Codes** (pickup, handover, delivery) are stored hashed, lock after 5 wrong tries, and are never shown on the rider's screen.
- **Money**: no payment gateway. Businesses transfer the delivery fee and upload a receipt; the super admin confirms within 15 minutes (target) before dispatch. Riders never handle money; customers pay businesses for goods outside the app.
- **Location** is recorded only while a trip is open; raw points are deleted after 30 days.
- **No registration or tax fields** anywhere (research ethics, dissertation 3.12). Study data is sample data only.

## Settings (editable by the super admin)

Fees by vehicle (bike, car, van, truck) and distance band (0–5, 5–15, 15–30, 30+ km); waiting charge ₦200 per started 5 minutes after 10 free; slots 8–10 … 6–8 Mon–Sat, 12–6 Sun, 15 orders per zone per slot, paid 1 hour before; claim limit ₦100,000, 48 h (24 h for missing items).

## Conventions

- Screens are listed in `src/pages/screens/registry.jsx`; menus and routes are generated from it. Replace a placeholder by giving the entry its real component.
- Plain CSS in `src/index.css`, Ọ̀nà's own "waybill and route" design: indigo surfaces with the adire stitch pattern, cool paper working surfaces, waybill cards (mono uppercase headers, dashed dividers, ticket notches), the dashed route line with a pickup dot and delivery pin, danfo-yellow accents. Indigo top bar with tabs on desktop, bottom tab bar on phones. Role colour is the band under the top bar (`[data-role]`). Do not bring back Verity's sidebar or 3D scene.
- Icons: `src/components/icons.jsx`; every screen in the registry names one.
- Write copy the way the person using the screen talks; name things by what they recognise.
- `supabase/functions/admin-users` creates businesses with owners, Operations staff and riders, each with a temporary password. Riders without e-mail log in as `<phone>@rider.ona.invalid`; `src/lib/login.js` builds the same address.
- Run `supabase/tests/0001_access_test.sql` after any change to tables, policies or functions; it must end with `ALL ACCESS TESTS PASSED`.
