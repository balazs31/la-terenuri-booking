# CLAUDE.md

Automatic court booking for sportinclujnapoca.ro ("La Terenuri"). Overview: `README.md`. Site API: `RESEARCH.md`.
Sibling project with the same architecture: `../programari-bistrita`.

## Stack

- `web/`: Vite + React 19 + TypeScript, supabase-js. No router, no UI library; plain CSS in `src/index.css`.
  UI copy is English; site data (sport/complex names) stays Romanian. Facility/complex ids: `src/lib/catalog.ts`.
- Supabase project `la-terenuri-booker`, ref `vaptvjibyittxyydyrwf` (eu-central-1), org ByteWave Digital.
  Managed through the Supabase MCP: `apply_migration`, `deploy_edge_function`, `execute_sql`.
- Checks: `cd web && npm run build` and `npx oxlint src`. Edge functions: no Deno locally. Type-check with tsc in a scratch
  dir that has `@supabase/ssr@0.12.7` + `@supabase/supabase-js@2.117.2` installed, `paths` mapping the `npm:…` specifiers to
  them and a tiny `Deno` declaration. Unit-test pure helpers of `_shared/terenuri.ts` with node (strip the imports).

## Conventions

- Every schema change is a new file in `supabase/migrations/` (timestamp prefix) **and** is applied with `apply_migration`
  under the same name. Never edit an applied migration.
- Deploying a function: include `_shared/terenuri.ts`, `_shared/store.ts` (and `_shared/http.ts` for browser-called ones),
  entrypoint `<name>/index.ts`. `run-bookings`: `verify_jwt` **false** (authenticated via `x-cron-secret` checked against Vault).
  `terenuri-check` (login test) and `terenuri-direct` (free hours of open days + book now): `verify_jwt` true.
- The site returns no free hours for days in a week where the user already has a booking for that sport.
- RLS: own rows (`user_id = auth.uid()`). The browser may only insert jobs and set `status = 'cancelled'` on pending ones;
  results are written by `run-bookings` with the service role. The La Terenuri password is only written via
  `set_terenuri_credentials()` (Vault) and read by `get_terenuri_credentials()` (service role). `terenuri_sessions` has no
  policies on purpose.
- Times: UI and site slots are Europe/Bucharest; the booking POST takes UTC ISO times; the DB stores `timestamptz`.
  pg_cron runs in UTC.
- Never book a day beyond Bucharest today + 14 (`isBookableBySiteRule`), even if the server shows free hours earlier.

## Booking engine (`supabase/functions/run-bookings`)

- Trigger `booking_jobs_set_window`: `release_at` = (target − 14 d) 00:00 Bucharest; watch window release − 2 min →
  release + 3 h 30 min, or now → now + 10 min if the day is already open.
- pg_cron ticks every minute and calls the function only while a pending job is in its window.
  `claim_booking_jobs(200)` leases jobs. A run lasts ~55 s, extended up to 100 s (leaves room for a POST under the 150 s
  wall clock) when 00:00 Bucharest or 00:00 UTC of the release day is near, polling every 1 s from −15 s to +120 s around
  those moments, every 20 s otherwise.
- Login: cached `@supabase/ssr` cookies in `terenuri_sessions`, refreshed when < 5 min left; password login otherwise.
- Weekly limit checked first (`get_user_app_count_per_facility` on the site's Supabase); > 0 → `failed`.
- Hour: `chooseHour()` — earliest free inside [pref_from, pref_to]; else closest, later on a tie.
- POST refused (`ok:false`) → back off ≥ 2 s and retry: up to 6 POSTs per run near an opening, 1 per run otherwise, 200 per
  job; distinct `messageCode`s are collected in `result_message`. POST threw → `uncertain`, stop.
- Notifications: CallMeBot WhatsApp to every enabled `notification_recipients` row, with the invite link.
