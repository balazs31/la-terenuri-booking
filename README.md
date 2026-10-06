# La Terenuri Booker

Books sports courts on **sportinclujnapoca.ro** (Cluj-Napoca: Baza „La Terenuri”, Baza Gheorgheni) the moment a new day opens.
The site lets you book up to 14 days ahead, so day D opens at **00:00 Romanian time on D − 14**, and the popular hours
are gone within minutes.

You pick a sport, location, day and a start-hour window (e.g. 18:00–20:00). A Supabase cron job logs in to the site just before
the day opens, polls every second around the opening, books the earliest free hour in your window (or the free hour closest to it
on the same day, the later one on a tie) and sends a WhatsApp message with the partner invite link.

## How it works

```
web (React, localhost:5180)  ──supabase-js──▶  Supabase project la-terenuri-booker (vaptvjibyittxyydyrwf)
                                                ├─ tables: booking_jobs, terenuri_accounts (+ Vault password),
                                                │          notification_recipients, terenuri_sessions (service role only)
                                                ├─ edge fn terenuri-check   ← Settings "Save & test"
                                                └─ pg_cron (every minute, only while a job is in its window)
                                                      └─▶ edge fn run-bookings
                                                            ├─ La Terenuri login (cached session, refreshed)
                                                            ├─ GET free hours, POST /api/reservations
                                                            └─ WhatsApp via CallMeBot
```

API details: `RESEARCH.md`. Conventions for changes: `CLAUDE.md`.

## Running locally

```bash
cd web
npm install
npm run dev -- --port 5180   # http://localhost:5180 (.env.local already points at the project)
```

First time:
1. Create an account (email + password) and confirm the email. Supabase's built-in mailer may only deliver to the org's
   team members; if nothing arrives, turn off *Confirm email* (Authentication → Sign In / Providers → Email) for the sign-up.
   If the confirmation link opens `localhost:3000`, the account is still confirmed; go back to `localhost:5180`.
2. **Disable new sign-ups** afterwards (the app stores a third-party password): Supabase dashboard → Authentication →
   Sign In / Providers → turn off *Allow new users to sign up*.
3. **Settings** → La Terenuri email + password → *Save & test*. It should say "Logged in as …" and list tomorrow's free tennis hours.
4. **Settings** → add WhatsApp recipients (CallMeBot number + API key) → *Test*.

## Using it

**New booking** → sport, location, day, From/To start hours → *Schedule booking*.

- A day that opens later: the job starts 2 minutes before 00:00 on day − 14 and watches until 03:30 (it also polls fast
  around 00:00 UTC in case the server counts days in UTC; to be confirmed, see below).
- A day that's already open: it tries right away, for 10 minutes.
- *Dry run*: does everything except the booking POST and reports the hour it would have taken. Use it to watch an opening.

Statuses: `pending` → `booked` / `simulated` (dry run) / `failed` (nothing found in time, weekly limit, login rejected) /
`cancelled` (by you) / `uncertain` (booking sent but no clear answer — check *Rezervările mele* on the site; the job stops to avoid
a double booking).

Site rules the bot respects: never books a day beyond today + 14; one booking per sport per week (checked before polling);
team sports (tennis needs 2 players) must be confirmed by the partner **within 2 hours** via the invite link, otherwise the site
cancels the reservation. Cancel a reservation on the site itself (*Rezervările mele*, until 3 h before).

## Open questions

- Exact moment a day opens (00:00 Bucharest assumed). The *Day opened* line on a job shows when the first free hour was seen.

## Deploying backend changes

Set up through the Supabase MCP; with the CLI:

```bash
supabase link --project-ref vaptvjibyittxyydyrwf
supabase db push
supabase functions deploy run-bookings --no-verify-jwt
supabase functions deploy terenuri-check
```

Vault secrets used by the cron job (already created): `project_url`, `cron_secret`.
