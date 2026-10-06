// New booking page: free hours of the days that are already open, and booking one of them right away.
// POST { action: "slots", complexId, facilityId }
//   → { ok, days: [{ date, free: [hours] }], weekCounts: { [monday]: n } }
// POST { action: "book", complexId, complexName, facilityId, facilityName, minPeople, date, hour }
//   → { ok, message, jobId?, inviteLink? }   (the booking is also saved as a booking_jobs row)
// verify_jwt = true.
import { callerId, cors, json } from "../_shared/http.ts";
import { db, getCredentials, notify, terenuriLogin } from "../_shared/store.ts";
import {
  addDays,
  book,
  bucharestToday,
  freeHours,
  getSlots,
  inviteUrl,
  isBookableBySiteRule,
  LoginError,
  mondayOf,
  type Session,
  shortDate,
  weeklyCount,
} from "../_shared/terenuri.ts";

const DAYS_AHEAD = 14;
const CONCURRENCY = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

async function slots(s: Session, complexId: string, facilityId: string) {
  const today = bucharestToday();
  const dates = Array.from({ length: DAYS_AHEAD + 1 }, (_, i) => addDays(today, i));
  const days = await mapLimit(dates, CONCURRENCY, async (date) => {
    try {
      return { date, free: freeHours(await getSlots(s, complexId, facilityId, date), date) };
    } catch (e) {
      return { date, free: [] as number[], error: String(e) };
    }
  });
  const mondays = [...new Set(dates.map(mondayOf))];
  const counts = await Promise.all(mondays.map((m) => weeklyCount(s, facilityId, complexId, m).catch(() => 0)));
  return { ok: true, days, weekCounts: Object.fromEntries(mondays.map((m, i) => [m, counts[i]])) };
}

interface BookBody {
  complexId: string;
  complexName: string;
  facilityId: string;
  facilityName: string;
  minPeople: number;
  date: string;
  hour: number;
}

async function bookNow(userId: string, s: Session, b: BookBody) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date) || b.date < bucharestToday() || !isBookableBySiteRule(b.date)) {
    return { ok: false, message: "That day isn't open for booking." };
  }
  if (!Number.isInteger(b.hour) || b.hour < 0 || b.hour > 23) return { ok: false, message: "Invalid hour." };

  const job = {
    user_id: userId,
    complex_id: b.complexId,
    complex_name: b.complexName,
    facility_id: b.facilityId,
    facility_name: b.facilityName,
    min_people: b.minPeople,
    target_date: b.date,
    pref_from: b.hour,
    pref_to: b.hour,
    booked_hour: b.hour,
    booking_attempts: 1,
  };
  const label = `${b.facilityName} ${shortDate(b.date)} ${hh(b.hour)}–${hh(b.hour + 1)}`;

  let result;
  try {
    result = await book(s, { complexId: b.complexId, facilityId: b.facilityId, minPeople: b.minPeople, date: b.date, hour: b.hour });
  } catch (e) {
    await db.from("booking_jobs").insert({ ...job, status: "uncertain", result_message: String(e) });
    return { ok: false, message: `No clear answer from the site (${e}). Check "Rezervările mele" before trying again.` };
  }
  if (!result.ok || !result.data) {
    return { ok: false, message: `The site refused the booking: ${result.messageCode ?? "unknown"}.` };
  }

  const { data: row } = await db.from("booking_jobs").insert({
    ...job,
    status: "booked",
    court_id: result.data.courtId,
    reservation_id: result.data.id,
    invite_link: result.data.link,
    result_message: `${result.messageCode ?? "RESERVATION_SAVED"} (booked directly)`,
  }).select("id").single();
  await notify(
    userId,
    `✅ ${label} booked, ${b.complexName}.` +
      (b.minPeople > 1 ? ` Send your partner this link, they must confirm within 2 hours: ${inviteUrl(result.data.link)}` : ""),
  );
  return { ok: true, message: `Booked ${label}.`, jobId: row?.id, inviteLink: result.data.link };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const userId = await callerId(req);
  if (!userId) return json({ ok: false, message: "not signed in" }, 401);

  const body = await req.json().catch(() => ({}));
  if (!UUID.test(body.complexId ?? "") || !UUID.test(body.facilityId ?? "")) {
    return json({ ok: false, message: "complexId and facilityId are required" }, 400);
  }

  const creds = await getCredentials(userId);
  if (!creds) return json({ ok: false, message: "Save your La Terenuri login in Settings first." });

  let s: Session;
  try {
    s = await terenuriLogin(userId, creds);
  } catch (e) {
    return json({ ok: false, message: e instanceof LoginError ? `La Terenuri rejected the login: ${e.message}` : String(e) });
  }

  if (body.action === "slots") return json(await slots(s, body.complexId, body.facilityId));
  if (body.action === "book") return json(await bookNow(userId, s, body as BookBody));
  return json({ ok: false, message: "unknown action" }, 400);
});
