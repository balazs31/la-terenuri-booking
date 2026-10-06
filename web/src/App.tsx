import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { openedFromRecoveryLink, supabase } from "./lib/supabase";
import Login from "./pages/Login";
import SetPassword from "./pages/SetPassword";
import NewBooking from "./pages/NewBooking";
import Jobs from "./pages/Jobs";
import Settings from "./pages/Settings";

type Tab = "new" | "jobs" | "settings";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("new");
  const [recovering, setRecovering] = useState(openedFromRecoveryLink);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return null;
  if (!session) return <Login />;
  if (recovering) return <SetPassword onDone={() => setRecovering(false)} />;

  return (
    <div className="app">
      <header className="top">
        <h1>La Terenuri Booker</h1>
        <nav>
          <button className={tab === "new" ? "tab active" : "tab"} onClick={() => setTab("new")}>New booking</button>
          <button className={tab === "jobs" ? "tab active" : "tab"} onClick={() => setTab("jobs")}>Bookings</button>
          <button className={tab === "settings" ? "tab active" : "tab"} onClick={() => setTab("settings")}>Settings</button>
        </nav>
        <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>
      <main>
        {tab === "new" && <NewBooking onCreated={() => setTab("jobs")} onOpenSettings={() => setTab("settings")} />}
        {tab === "jobs" && <Jobs />}
        {tab === "settings" && <Settings />}
      </main>
    </div>
  );
}
