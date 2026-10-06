// Client for sportinclujnapoca.ro ("La Terenuri"), reverse-engineered from the site's JS (see RESEARCH.md).
// Auth: Supabase session cookie written by @supabase/ssr + a static app-wide Bearer key.
import { createServerClient } from "npm:@supabase/ssr@0.12.7";

export const SITE = "https://sportinclujnapoca.ro";
const API = `${SITE}/api`;
const SITE_SUPABASE_URL = "https://aibdnbgbsrqhefelcgtb.supabase.co";
const SITE_SUPABASE_KEY = "sb_publishable_jUOeK9gZS9vffHcOslwd9Q_NV8HvFTH";
const SITE_API_KEY = "03oh1qauroh55hxfyabbvuqwazlu3ruj"; // public, same for every user
const TZ = "Europe/Bucharest";
const REFRESH_IF_EXPIRES_WITHIN_S = 300;

export const inviteUrl = (link: string) => `${SITE}/reservations/confirm?id=${link}`;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Cookie {
  name: string;
  value: string;
}

export interface Session {
  client: ReturnType<typeof createServerClient>;
  jar: Map<string, string>;
  userId: string;
  name: string;
}

/** Wrong email/password — retrying won't help. */
export class LoginError extends Error {}

/**
 * Restores a cached session (refreshing it if it's about to expire) or logs in with the password.
 * Persist `[...session.jar]` afterwards: refreshing rotates the refresh token.
 */
export async function login(email: string, password: string, cached: Cookie[] = []): Promise<Session> {
  const jar = new Map(cached.map((c) => [c.name, c.value]));
  const client = createServerClient(SITE_SUPABASE_URL, SITE_SUPABASE_KEY, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });

  if (jar.size) {
    const { data } = await client.auth.getSession();
    const s = data.session;
    if (s && (s.expires_at ?? 0) - Date.now() / 1000 < REFRESH_IF_EXPIRES_WITHIN_S) await client.auth.refreshSession();
    const { data: u } = await client.auth.getUser();
    if (u.user) return await withCookies({ client, jar, userId: u.user.id, name: displayName(u.user.user_metadata) });
    jar.clear();
  }

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === "invalid_credentials" || error.status === 400) throw new LoginError(error.message);
    throw new Error(`login: ${error.message}`);
  }
  return await withCookies({ client, jar, userId: data.user.id, name: displayName(data.user.user_metadata) });
}

/** @supabase/ssr writes cookies from an auth event; give it a moment. */
async function withCookies(s: Session): Promise<Session> {
  for (let i = 0; i < 40 && !s.jar.size; i++) await sleep(25);
  if (!s.jar.size) throw new Error("login succeeded but no session cookie was written");
  return s;
}

const displayName = (m: Record<string, string> | undefined) => [m?.firstName, m?.lastName].filter(Boolean).join(" ");

const cookieHeader = (s: Session) => [...s.jar].map(([k, v]) => `${k}=${v}`).join("; ");

async function api<T>(s: Session, method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 10_000) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: "application/json, text/plain, */*",
      Authorization: `Bearer ${SITE_API_KEY}`,
      Cookie: cookieHeader(s),
      Origin: SITE,
      Referer: `${SITE}/`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json: T | undefined;
  try {
    json = JSON.parse(text) as T;
  } catch {
    // not JSON
  }
  return { status: res.status, json, text };
}

export async function getRaw(s: Session, path: string) {
  return await api<unknown>(s, "GET", path);
}

export interface TimeSlot {
  slot: string; // "YYYY-MM-DD HH:mm:ss", Bucharest time
  courtId: string | null;
  is_Blocked: boolean;
}

export async function getSlots(s: Session, complexId: string, facilityId: string, date: string): Promise<TimeSlot[]> {
  const qs = new URLSearchParams({ complexId, facilityId, date });
  const r = await api<{ timeSlots?: TimeSlot[] }>(s, "GET", `/calendar/facility-time-slots-with-exception?${qs}`);
  if (r.status !== 200 || !r.json?.timeSlots) throw new Error(`slots HTTP ${r.status}: ${r.text.slice(0, 200)}`);
  return r.json.timeSlots;
}

/** Free start hours on `date` (still in the future), ascending. */
export function freeHours(slots: TimeSlot[], date: string, now = new Date()): number[] {
  return slots
    .filter((t) => t.slot.startsWith(date) && !t.is_Blocked && t.courtId)
    .map((t) => Number(t.slot.slice(11, 13)))
    .filter((h) => bucharestToUtc(date, h).getTime() > now.getTime())
    .sort((a, b) => a - b);
}

/**
 * Earliest free hour inside [from, to]; otherwise the free hour closest to the window,
 * the later one on a tie. Null if nothing is free.
 */
export function chooseHour(free: number[], from: number, to: number): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const h of [...free].sort((a, b) => a - b)) {
    const dist = h < from ? from - h : h > to ? h - to : 0;
    if (dist < bestDist || (dist === bestDist && dist > 0)) {
      best = h;
      bestDist = dist;
    }
  }
  return best;
}

/** Reservations the user already has for this sport in the ISO week of `date` (site limit: 1). */
export async function weeklyCount(s: Session, facilityId: string, complexId: string, date: string): Promise<number> {
  const monday = mondayOf(date);
  const { data, error } = await s.client.rpc("get_user_app_count_per_facility", {
    p_facility_id: facilityId,
    p_start_date_from: monday,
    p_start_date_to: addDays(monday, 7),
    p_user_id: s.userId,
    p_sports_complex_id: complexId,
  });
  if (error) throw new Error(`weekly count: ${error.message}`);
  return Number(data ?? 0);
}

export interface BookRequest {
  complexId: string;
  facilityId: string;
  minPeople: number;
  date: string; // YYYY-MM-DD
  hour: number;
}

export interface BookResult {
  ok: boolean;
  messageCode?: string;
  data?: { id: string; courtId: string; link: string; status: string };
}

/** Throws when the outcome is unknown (network error / timeout / non-JSON answer). */
export async function book(s: Session, r: BookRequest): Promise<BookResult> {
  const start = bucharestToUtc(r.date, r.hour);
  const body = {
    sportsComplexId: r.complexId,
    courtId: null, // let the server pick, like the site does when no court is chosen
    facilityId: r.facilityId,
    startTime: start.toISOString(),
    endTime: new Date(start.getTime() + 3_600_000).toISOString(),
    type: r.minPeople > 1 ? "team" : "individual",
    createdBy: s.userId,
    ownerId: s.userId,
    groupId: null,
  };
  const res = await api<BookResult>(s, "POST", "/reservations", body, 20_000);
  if (!res.json || typeof res.json.ok !== "boolean") throw new Error(`booking HTTP ${res.status}: ${res.text.slice(0, 200)}`);
  return res.json;
}

// --- Time (Europe/Bucharest) -------------------------------------------------------------------

function partsIn(d: Date) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second };
}

/** UTC instant of a Bucharest wall-clock hour on `date` (YYYY-MM-DD). */
export function bucharestToUtc(date: string, hour: number, minute = 0): Date {
  const [y, m, d] = date.split("-").map(Number);
  const asUtc = Date.UTC(y, m - 1, d, hour, minute);
  let t = asUtc;
  for (let i = 0; i < 2; i++) {
    const p = partsIn(new Date(t));
    const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - t;
    t = asUtc - offset;
  }
  return new Date(t);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Today in Bucharest as YYYY-MM-DD. */
export function bucharestToday(now = new Date()): string {
  const p = partsIn(now);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const r = new Date(Date.UTC(y, m - 1, d + days));
  return `${r.getUTCFullYear()}-${pad(r.getUTCMonth() + 1)}-${pad(r.getUTCDate())}`;
}

export function mondayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

/** The site lets you book up to today + 14 days (Bucharest calendar). Never book beyond that. */
export const isBookableBySiteRule = (date: string, now = new Date()) => date <= addDays(bucharestToday(now), 14);

/** DD.MM */
export const shortDate = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}`;
