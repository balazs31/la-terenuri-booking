import { useCallback, useEffect, useState, type FormEvent } from "react";
import { supabase, type TerenuriAccount } from "../lib/supabase";
import { formatBucharest } from "../lib/time";

type Status = { kind: "error" | "info"; text: string } | null;

function TerenuriLogin() {
  const [account, setAccount] = useState<TerenuriAccount | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("terenuri_accounts")
      .select("email, terenuri_user_id, display_name, verified_at, last_error").maybeSingle();
    if (error) return setStatus({ kind: "error", text: error.message });
    setAccount(data);
    if (data) setEmail(data.email);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function test() {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke<{ ok: boolean; message: string }>("terenuri-check");
    setBusy(false);
    if (error) setStatus({ kind: "error", text: error.message });
    else if (data) setStatus({ kind: data.ok ? "info" : "error", text: data.message });
    load();
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setStatus(null);
    const { error } = await supabase.rpc("set_terenuri_credentials", { p_email: email.trim(), p_password: password });
    if (error) return setStatus({ kind: "error", text: error.message });
    setPassword("");
    await test();
  }

  async function remove() {
    const { error } = await supabase.rpc("delete_terenuri_credentials");
    if (error) return setStatus({ kind: "error", text: error.message });
    setEmail("");
    setStatus({ kind: "info", text: "Removed." });
    load();
  }

  return (
    <form className="card stack" onSubmit={save}>
      <h2>La Terenuri login</h2>
      <p className="muted">
        Your sportinclujnapoca.ro account. The password is stored encrypted (Supabase Vault) and only the booking job
        can read it; this page can't show it again.
      </p>
      {account && (
        <p className={account.verified_at ? "info" : "error"}>
          {account.verified_at
            ? `✓ Works — ${account.display_name || account.email}, checked ${formatBucharest(account.verified_at)}`
            : account.last_error ? `✗ ${account.last_error}` : "Not tested yet."}
        </p>
      )}
      <div className="grid2">
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required={!account}
            placeholder={account ? "unchanged" : ""}
            autoComplete="new-password"
          />
        </label>
      </div>
      {status && <p className={status.kind}>{status.text}</p>}
      <div className="row">
        <button type="submit" disabled={busy}>{busy ? "Testing…" : "Save & test"}</button>
        {account && <button type="button" className="secondary" onClick={test} disabled={busy}>Test again</button>}
        {account && <button type="button" className="link danger" onClick={remove} disabled={busy}>Remove</button>}
      </div>
    </form>
  );
}

interface Recipient {
  id: string;
  label: string;
  whatsapp_phone: string;
  callmebot_apikey: string;
  enabled: boolean;
}

const normalizePhone = (p: string) => p.replace(/\D/g, "");
const isValidIntlPhone = (p: string) => /^[1-9]\d{7,14}$/.test(p);

function sendTest(r: Pick<Recipient, "whatsapp_phone" | "callmebot_apikey">) {
  const qs = new URLSearchParams({ phone: r.whatsapp_phone, text: "Test: La Terenuri Booker", apikey: r.callmebot_apikey });
  // CallMeBot has no CORS headers; the request still goes out, we just can't read the response.
  fetch(`https://api.callmebot.com/whatsapp.php?${qs}`, { mode: "no-cors" });
}

function Recipients() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [label, setLabel] = useState("");
  const [phone, setPhone] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<Status>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("notification_recipients").select("*").order("created_at");
    if (error) setStatus({ kind: "error", text: error.message });
    else setRecipients(data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    const p = normalizePhone(phone);
    if (!isValidIntlPhone(p)) return setStatus({ kind: "error", text: "Use international format without +, e.g. 40712345678." });
    if (!apiKey.trim()) return setStatus({ kind: "error", text: "API key is required." });
    const { error } = await supabase.from("notification_recipients").insert({
      label: label.trim(),
      whatsapp_phone: p,
      callmebot_apikey: apiKey.trim(),
    });
    if (error) return setStatus({ kind: "error", text: error.message });
    setLabel("");
    setPhone("");
    setApiKey("");
    setStatus({ kind: "info", text: "Added." });
    load();
  }

  async function toggle(r: Recipient) {
    const { error } = await supabase.from("notification_recipients").update({ enabled: !r.enabled }).eq("id", r.id);
    if (error) setStatus({ kind: "error", text: error.message });
    load();
  }

  async function remove(r: Recipient) {
    const { error } = await supabase.from("notification_recipients").delete().eq("id", r.id);
    if (error) setStatus({ kind: "error", text: error.message });
    load();
  }

  return (
    <>
      <section className="card stack">
        <h2>WhatsApp notifications (CallMeBot)</h2>
        <p className="muted">
          Every enabled number gets the result, including the invite link for your partner (they have 2 hours to
          confirm). Each number needs its own API key: from that phone, add +34 644 71 81 99 to contacts and send it
          “I allow callmebot to send me messages”.
        </p>
        {recipients.length === 0 && <p className="muted">No recipients yet.</p>}
        {recipients.length > 0 && (
          <ul className="recipients">
            {recipients.map((r) => (
              <li key={r.id} className={r.enabled ? "" : "disabled"}>
                <div>
                  <strong>{r.label || "—"}</strong>
                  <span className="muted">+{r.whatsapp_phone}</span>
                </div>
                <div className="row">
                  <button type="button" className="link" onClick={() => {
                    sendTest(r);
                    setStatus({ kind: "info", text: `Test sent to ${r.label || "+" + r.whatsapp_phone} — check WhatsApp.` });
                  }}>
                    Test
                  </button>
                  <button type="button" className="link" onClick={() => toggle(r)}>{r.enabled ? "Disable" : "Enable"}</button>
                  <button type="button" className="link danger" onClick={() => remove(r)}>Remove</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form className="card stack" onSubmit={add}>
        <h2>Add recipient</h2>
        <div className="grid3">
          <label>
            Label
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Me" />
          </label>
          <label>
            WhatsApp number (no +)
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="407xxxxxxxx" inputMode="tel" />
          </label>
          <label>
            CallMeBot API key
            <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </label>
        </div>
        {status && <p className={status.kind}>{status.text}</p>}
        <button type="submit">Add</button>
      </form>
    </>
  );
}

export default function Settings() {
  return (
    <div className="stack">
      <TerenuriLogin />
      <Recipients />
    </div>
  );
}
