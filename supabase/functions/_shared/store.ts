// Our own Supabase project: credentials, cached La Terenuri sessions, notifications. Service role.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { type Cookie, login, type Session } from "./terenuri.ts";

export const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

export async function getCredentials(userId: string): Promise<{ email: string; password: string } | null> {
  const { data, error } = await db.rpc("get_terenuri_credentials", { p_user_id: userId });
  if (error) throw new Error(`get_terenuri_credentials: ${error.message}`);
  return (data as { email: string; password: string }[])[0] ?? null;
}

/** Logs in to La Terenuri, reusing the cached session unless `fresh`. Saves the (possibly rotated) session. */
export async function terenuriLogin(userId: string, creds: { email: string; password: string }, fresh = false) {
  let cached: Cookie[] = [];
  if (!fresh) {
    const { data } = await db.from("terenuri_sessions").select("email, cookies").eq("user_id", userId).maybeSingle();
    if (data && data.email === creds.email) cached = data.cookies as Cookie[];
  }
  const session = await login(creds.email, creds.password, cached);
  await saveSession(userId, creds.email, session);
  return session;
}

export async function saveSession(userId: string, email: string, s: Session) {
  const cookies = [...s.jar].map(([name, value]) => ({ name, value }));
  const { error } = await db.from("terenuri_sessions")
    .upsert({ user_id: userId, email, cookies, updated_at: new Date().toISOString() });
  if (error) console.error("saveSession", error.message);
}

/** WhatsApp via CallMeBot to every enabled recipient of the user. */
export async function notify(userId: string, text: string) {
  const { data: recipients } = await db.from("notification_recipients")
    .select("label, whatsapp_phone, callmebot_apikey").eq("user_id", userId).eq("enabled", true);
  await Promise.all((recipients ?? []).map(async (r) => {
    const qs = new URLSearchParams({ phone: r.whatsapp_phone, text, apikey: r.callmebot_apikey });
    try {
      const res = await fetch(`https://api.callmebot.com/whatsapp.php?${qs}`, { signal: AbortSignal.timeout(15_000) });
      console.log(`WhatsApp to ${r.label || "recipient"}: HTTP ${res.status}`);
    } catch (e) {
      console.error(`WhatsApp to ${r.label || "recipient"} failed`, e);
    }
  }));
}
