import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const { data, error } = mode === "signin"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    if (error) return setMessage({ kind: "error", text: error.message });
    if (mode === "signup" && !data.session) {
      setMessage({ kind: "info", text: "Account created. Confirm your email, then sign in." });
      setMode("signin");
    }
  }

  return (
    <main className="auth">
      <h1>La Terenuri Booker</h1>
      <p className="muted">Books sports courts on sportinclujnapoca.ro the moment a new day opens</p>
      <form className="card stack" onSubmit={submit}>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
          />
        </label>
        {message && <p className={message.kind}>{message.text}</p>}
        <button type="submit" disabled={busy}>{mode === "signin" ? "Sign in" : "Create account"}</button>
        <button type="button" className="link" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
          {mode === "signin" ? "No account yet? Create one" : "Have an account? Sign in"}
        </button>
      </form>
    </main>
  );
}
