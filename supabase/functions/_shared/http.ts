// Helpers for functions called from the browser (verify_jwt = true).
import { db } from "./store.ts";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** Our user's id from the request's JWT, or null. */
export async function callerId(req: Request): Promise<string | null> {
  const jwt = req.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
  const { data } = await db.auth.getUser(jwt);
  return data.user?.id ?? null;
}
