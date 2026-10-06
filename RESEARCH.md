# sportinclujnapoca.ro — booking API research (2026-10-06)

## Architecture
- Frontend: Next.js (pages router), build id `MHfw6dkx1AojrZjwARcCx`.
- Auth + reads: Supabase project `https://aibdnbgbsrqhefelcgtb.supabase.co` (email/password auth, PostgREST, RPCs).
- Writes: Next.js API at `https://sportinclujnapoca.ro/api`, called with axios:
  - `Authorization: Bearer 03oh1qauroh55hxfyabbvuqwazlu3ruj` (static, app-wide, public in JS bundle — same for every user)
  - `withCredentials: true` → user identity comes from the Supabase session cookie. Verified: without the cookie the API returns `401 {"ok":false,"messageCode":"UNAUTHORIZED"}`.
- Supabase publishable key (public, in bundle): `sb_publishable_jUOeK9gZS9vffHcOslwd9Q_NV8HvFTH`.
- Login: plain `supabase.auth.signInWithPassword({email,password})` — no captcha on the login page.
- Session cookie: written by `@supabase/ssr` `createBrowserClient`. Name `sb-aibdnbgbsrqhefelcgtb-auth-token`, value `base64-` + base64url(JSON session); split into `.0`, `.1`… chunks when long. (Format from the library code; actual cookie not observed — cookie reads are blocked in the browser tool.) The bot can log in with supabase-js + a cookie storage adapter (or `@supabase/ssr` `createServerClient`) and send the same cookie.

## Key IDs
| What | ID |
|---|---|
| Sports complex "La Terenuri" (slug `la-terenuri-base`) | `3181c65a-3ae6-4668-a7e7-32523d3c0d9e` |
| Facility: tennis | `1daabab3-899f-441c-b203-5ed29eb6662e` |
| Tennis court (seen) | `16cbef87-1ae9-4242-a340-76b04672ad91` |
| Tennis court (seen) | `2d67420f-3543-48f5-9c69-0e5b7606ef94` |
| My user id | `<your user id>` (from `GET /auth/v1/user`) |

Other facilities (slugs): squash, skittles, football, basketball, volleyball, wall-tennis, table-tennis. Gheorgheni base = `gheorgheni-base`.
Full list: Supabase RPC `get_facilities_with_complexes`, tables `sports_complexes`, `courts`.

## Endpoints

### Availability
`GET /api/calendar/facility-time-slots-with-exception?complexId=…&facilityId=…&date=YYYY-MM-DD[&courtId=…]`
```json
{"timeSlots":[{"slot":"2026-10-19 09:00:00","courtId":"16cbef87-…","is_Blocked":false},
              {"slot":"2026-10-20 11:00:00","courtId":null,"is_Blocked":true}]}
```
- Slot times are local (Europe/Bucharest). `is_Blocked:true` / `courtId:null` = taken.
- Without `courtId`, the server suggests a free court per slot.

### Weekly quota check (Supabase)
`POST /rest/v1/rpc/get_user_app_count_per_facility`
```json
{"p_facility_id":"…","p_start_date_from":"2026-10-19","p_start_date_to":"2026-10-26","p_user_id":"…","p_sports_complex_id":"…"}
```
→ `0` / `1`. If ≥1 the UI blocks: "Ai atins limita de rezervări admise pentru tenis în această săptămână."

### Create reservation
`POST /api/reservations`
```json
{"sportsComplexId":"3181c65a-…","courtId":null,"facilityId":"1daabab3-…",
 "startTime":"2026-10-19T06:00:00.000Z","endTime":"2026-10-19T07:00:00.000Z",
 "type":"team","createdBy":"<userId>","ownerId":"<userId>","groupId":null}
```
→ `{"ok":true,"messageCode":"RESERVATION_SAVED","data":{"id":"…","courtId":"…","status":"confirmed","link":"qv2952domi",…}}`
- Times are UTC ISO (09:00 Bucharest = 06:00Z in summer time, 07:00Z after DST ends on Oct 25).
- `courtId:null` → server picks the court.
- On failure `ok:false` + `messageCode` (UI shows "slot was just taken by another player").

### After booking
- `GET /api/reservations/details/{id}` → participants.
- Invite link: `https://sportinclujnapoca.ro/reservations/confirm?id={link}` — partner opens it (logged in) and confirms → `PATCH /api/reservations/confirm-presence`.
- Cancel: `PATCH /api/reservations/cancel` `{reservationId}` (allowed until 3h before).

## Business rules (affect the bot)
- 1h slots, 09:00–22:00 (last start 21:00).
- Booking window: **today + 14 days** (client: `dayjs().add(14,'day')`). On 2026-10-06 the last bookable day was 2026-10-20.
- **1 booking per sport per ISO week** per user.
- Tennis needs **2 participants: the partner must confirm within 2 hours** or the booking is auto-cancelled. The rule limits *participation* to once per week per sport, so the partner's weekly tennis quota is used too.
- Partner flow (decided): the bot books, then notifies me with the invite link; I forward it to my partner manually. So the bot must notify me immediately (2h clock).
- Competition is high: the newest day (Oct 20) was almost fully booked hours after opening.

## Open questions
- Exact release moment of the new day (assumed 00:00 Europe/Bucharest) and whether the server enforces the 14-day window → verify by polling the slots endpoint around midnight.
- Session lifetime / refresh: use Supabase refresh token to keep the bot logged in.
