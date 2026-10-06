// Settings → "Test login": logs in to La Terenuri with the saved credentials and makes two read-only calls
// (my reservation count, tomorrow's tennis slots) to prove the session cookie works. verify_jwt = true.
import { db, getCredentials, terenuriLogin } from "../_shared/store.ts";
import { addDays, bucharestToday, freeHours, getRaw, getSlots, LoginError } from "../_shared/terenuri.ts";

const LA_TERENURI = "3181c65a-3ae6-4668-a7e7-32523d3c0d9e";
const TENNIS = "1daabab3-899f-441c-b203-5ed29eb6662e";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const jwt = req.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
  const { data: auth } = await db.auth.getUser(jwt);
  const userId = auth.user?.id;
  if (!userId) return json({ ok: false, message: "not signed in" }, 401);

  const creds = await getCredentials(userId);
  if (!creds) return json({ ok: false, message: "Save your La Terenuri email and password first." });

  try {
    const s = await terenuriLogin(userId, creds, true);
    const count = await getRaw(s, "/reservations/my-reservations/count");
    if (count.status !== 200) throw new Error(`session not accepted by the site (HTTP ${count.status}: ${count.text.slice(0, 120)})`);
    const date = addDays(bucharestToday(), 1);
    const free = freeHours(await getSlots(s, LA_TERENURI, TENNIS, date), date);

    await db.from("terenuri_accounts").update({
      terenuri_user_id: s.userId,
      display_name: s.name,
      verified_at: new Date().toISOString(),
      last_error: null,
    }).eq("user_id", userId);
    return json({
      ok: true,
      name: s.name,
      message: `Logged in as ${s.name || creds.email}. Tennis at La Terenuri tomorrow (${date}): ` +
        (free.length ? `free at ${free.map((h) => `${h}:00`).join(", ")}.` : "fully booked."),
    });
  } catch (e) {
    const message = e instanceof LoginError ? `La Terenuri rejected the login: ${e.message}` : String(e);
    await db.from("terenuri_accounts").update({ verified_at: null, last_error: message }).eq("user_id", userId);
    return json({ ok: false, message });
  }
});
