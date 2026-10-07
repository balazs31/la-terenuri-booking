// Invoked every minute by pg_cron while a booking job is inside its watch window.
// Leases the due jobs, logs in to La Terenuri and polls the day's free hours; books as soon as one is acceptable.
// Around the moments a day may open (00:00 Bucharest, 00:00 UTC) a run starting just before stays alive up to 100 s and
// polls every second, so the opening doesn't fall between two runs. Deployed with verify_jwt = false (x-cron-secret instead).
import { db, getCredentials, notify, terenuriLogin } from "../_shared/store.ts";
import {
  addDays,
  book,
  chooseHour,
  describeSlots,
  freeHours,
  getSlots,
  inviteUrl,
  isBookableBySiteRule,
  LoginError,
  mondayOf,
  type Session,
  shortDate,
  sleep,
  weeklyCount,
} from "../_shared/terenuri.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const NORMAL_RUN_MS = 55_000;
// Under the 150 s edge-function wall clock, leaving room for a booking POST (20 s timeout) + save + notify.
const MAX_RUN_MS = 100_000;
const LEASE_S = 200;
const FAST_POLL_MS = 1_000;
const SLOW_POLL_MS = 20_000;
const HOT_BEFORE_MS = 15_000;
const HOT_AFTER_MS = 120_000;
// Refused POSTs (e.g. the server doesn't accept the day yet): retry a few times per run around an opening,
// once per run otherwise, so a job survives until the next possible opening moment.
const MAX_POSTS_PER_RUN_HOT = 6;
const MAX_POSTS_PER_RUN_SLOW = 1;
const REFUSED_RETRY_MS = 2_000;
const MAX_BOOKING_POSTS = 200;

interface Job {
  id: string;
  user_id: string;
  complex_id: string;
  complex_name: string;
  facility_id: string;
  facility_name: string;
  min_people: number;
  target_date: string; // YYYY-MM-DD
  pref_from: number;
  pref_to: number;
  dry_run: boolean;
  release_at: string;
  give_up_at: string;
  first_free_seen_at: string | null;
  attempts: number;
  booking_attempts: number;
}

const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** When the day may open: 00:00 Bucharest (the site's 14-day rule) or 00:00 UTC (if the server counts days in UTC). */
const hotMoments = (job: Job) => [Date.parse(job.release_at), Date.parse(`${addDays(job.target_date, -14)}T00:00:00Z`)];

function runUntil(job: Job, t0: number) {
  let stopAt = t0 + NORMAL_RUN_MS;
  for (const h of hotMoments(job)) {
    if (h + HOT_AFTER_MS > t0 && h - HOT_BEFORE_MS < t0 + NORMAL_RUN_MS) {
      stopAt = Math.max(stopAt, Math.min(t0 + MAX_RUN_MS, h + HOT_AFTER_MS));
    }
  }
  return stopAt;
}

const isHot = (job: Job, now: number) => hotMoments(job).some((h) => now >= h - HOT_BEFORE_MS && now < h + HOT_AFTER_MS);

function nextDelay(job: Job, now: number) {
  let delay = SLOW_POLL_MS;
  for (const h of hotMoments(job)) {
    if (now >= h - HOT_BEFORE_MS && now < h + HOT_AFTER_MS) return FAST_POLL_MS;
    if (h - HOT_BEFORE_MS > now) delay = Math.min(delay, h - HOT_BEFORE_MS - now);
  }
  return delay;
}

const finish = (id: string, fields: Record<string, unknown>) =>
  db.from("booking_jobs").update({ ...fields, locked_until: null, updated_at: new Date().toISOString() }).eq("id", id);

async function runJob(job: Job, t0: number) {
  const label = `${job.facility_name} ${shortDate(job.target_date)} ${hh(job.pref_from)}–${hh(job.pref_to)}`;
  const giveUpAt = Date.parse(job.give_up_at);
  const deadline = Math.min(runUntil(job, t0), giveUpAt);
  let attempts = 0;
  let posts = job.booking_attempts;
  let postsThisRun = 0;
  const refusals = new Set<string>();
  let lastMessage = "No free hour yet";
  let lastShape = "";
  const save = (fields: Record<string, unknown>) =>
    finish(job.id, { attempts: job.attempts + attempts, booking_attempts: posts, ...fields });
  const fail = async (message: string) => {
    await save({ status: "failed", result_message: message });
    await notify(job.user_id, `❌ ${label}: ${message}`);
  };

  if (Date.now() < giveUpAt) {
    const creds = await getCredentials(job.user_id);
    if (!creds) return await fail("No La Terenuri login saved (Settings).");

    let s: Session;
    try {
      s = await terenuriLogin(job.user_id, creds);
    } catch (e) {
      if (e instanceof LoginError) return await fail(`La Terenuri rejected the login (${e.message}). Fix it in Settings.`);
      return await save({ result_message: `Login failed, retrying next minute: ${e}` });
    }

    try {
      const n = await weeklyCount(s, job.facility_id, job.complex_id, job.target_date);
      if (n > 0 && !job.dry_run) {
        return await fail(`You already have a ${job.facility_name} booking in the week of ${shortDate(mondayOf(job.target_date))}.`);
      }
      if (n > 0) lastMessage = "Dry run: weekly limit already reached, a real job would stop here";
    } catch (e) {
      console.warn(`[${job.id}] ${e}`);
    }

    while (Date.now() < deadline) {
      attempts++;
      let free: number[] = [];
      try {
        const slots = await getSlots(s, job.complex_id, job.facility_id, job.target_date);
        const shape = describeSlots(slots, job.target_date);
        if (shape !== lastShape) console.log(`[${job.id}] slots: ${shape}`);
        lastShape = shape;
        free = freeHours(slots, job.target_date);
      } catch (e) {
        lastMessage = String(e);
      }
      if (free.length && !job.first_free_seen_at) {
        job.first_free_seen_at = new Date().toISOString();
        await db.from("booking_jobs").update({ first_free_seen_at: job.first_free_seen_at }).eq("id", job.id);
      }

      const hour = chooseHour(free, job.pref_from, job.pref_to);
      if (hour !== null && !isBookableBySiteRule(job.target_date)) {
        // The site's own rule says the day isn't open yet: never book early.
        lastMessage = `Free hours visible before the day opens (${free.map(hh).join(", ")}); waiting`;
      } else if (hour !== null && job.dry_run) {
        await save({ status: "simulated", booked_hour: hour, result_message: `Would book ${hh(hour)}. Free: ${free.map(hh).join(", ")}` });
        await notify(job.user_id, `🧪 Dry run ${label}: would book ${hh(hour)} (free: ${free.map(hh).join(", ")}).`);
        return;
      } else if (hour !== null && postsThisRun >= (isHot(job, Date.now()) ? MAX_POSTS_PER_RUN_HOT : MAX_POSTS_PER_RUN_SLOW)) {
        lastMessage = `Free hours visible but booking refused (${[...refusals].join(", ")}); retrying later`;
      } else if (hour !== null) {
        posts++;
        postsThisRun++;
        let result;
        try {
          result = await book(s, { complexId: job.complex_id, facilityId: job.facility_id, minPeople: job.min_people, date: job.target_date, hour });
        } catch (e) {
          // The request may have reached the site; don't risk a second booking.
          await save({ status: "uncertain", booked_hour: hour, result_message: String(e) });
          await notify(job.user_id, `⚠️ ${label}: booking ${hh(hour)} sent but no clear answer. Check "Rezervările mele" on the site.`);
          return;
        }
        if (result.ok && result.data) {
          const link = result.data.link;
          await save({
            status: "booked",
            booked_hour: hour,
            court_id: result.data.courtId,
            reservation_id: result.data.id,
            invite_link: link,
            result_message: result.messageCode ?? "RESERVATION_SAVED",
          });
          await notify(
            job.user_id,
            `✅ ${job.facility_name} booked: ${shortDate(job.target_date)} ${hh(hour)}–${hh(hour + 1)}, ${job.complex_name}.` +
              (job.min_people > 1 ? ` Send your partner this link, they must confirm within 2 hours: ${inviteUrl(link)}` : ""),
          );
          return;
        }
        // Usually taken by someone else between the check and the booking; look again shortly.
        refusals.add(result.messageCode ?? "unknown");
        lastMessage = `Booking ${hh(hour)} refused: ${[...refusals].join(", ")}`;
        console.log(`[${job.id}] ${lastMessage}`);
        if (posts >= MAX_BOOKING_POSTS) return await fail(`${posts} booking attempts refused (${[...refusals].join(", ")})`);
        const retry = Math.min(Math.max(REFUSED_RETRY_MS, nextDelay(job, Date.now())), deadline - Date.now());
        if (retry > 0) await sleep(retry);
        continue;
      } else if (free.length === 0 && job.first_free_seen_at) {
        lastMessage = "Day is fully booked; watching for cancellations";
      }

      console.log(`[${job.id}] check ${attempts}: ${lastMessage}`);
      const wait = Math.min(nextDelay(job, Date.now()), deadline - Date.now());
      if (wait > 0) await sleep(wait);
    }
  }

  if (Date.now() >= giveUpAt) return await fail(lastMessage);
  await save({ result_message: lastMessage });
}

async function run() {
  const t0 = Date.now();
  const { data: jobs, error } = await db.rpc("claim_booking_jobs", { lease_seconds: LEASE_S });
  if (error) return console.error("claim_booking_jobs", error);
  const results = await Promise.allSettled((jobs as Job[]).map((job) => runJob(job, t0)));
  for (const [i, r] of results.entries()) {
    if (r.status === "rejected") {
      console.error(r.reason);
      await finish((jobs as Job[])[i].id, { result_message: `Error: ${r.reason}` });
    }
  }
  console.log(`processed ${results.length} job(s) in ${Math.round((Date.now() - t0) / 1000)}s`);
}

Deno.serve(async (req) => {
  const { data: secret } = await db.rpc("get_cron_secret");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return new Response("forbidden", { status: 403 });
  // pg_net only waits 5 s for the response; keep working in the background.
  EdgeRuntime.waitUntil(run());
  return new Response("accepted", { status: 202 });
});
