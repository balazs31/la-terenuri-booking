import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

/** Shown after opening a password-reset link (the link already signed the user in). */
export default function SetPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== repeat) return setError("The passwords don't match.");
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(error.message);
    history.replaceState(null, "", window.location.pathname);
    onDone();
  }

  return (
    <main className="auth">
      <h1>La Terenuri Booker</h1>
      <p className="muted">Choose a new password for this app.</p>
      <form className="card stack" onSubmit={submit}>
        <label>
          New password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
        </label>
        <label>
          Repeat it
          <input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required minLength={8} autoComplete="new-password" />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
      </form>
    </main>
  );
}
