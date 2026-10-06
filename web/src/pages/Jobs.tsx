import { useCallback, useEffect, useState } from "react";
import { type BookingJob, inviteUrl, supabase } from "../lib/supabase";
import { formatBucharest, formatDate, hourLabel } from "../lib/time";

const STATUS_LABEL: Record<BookingJob["status"], string> = {
  pending: "Pending",
  booked: "Booked",
  simulated: "Dry run done",
  failed: "Not booked",
  cancelled: "Cancelled",
  uncertain: "Check the site",
};

export default function Jobs() {
  const [jobs, setJobs] = useState<BookingJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("booking_jobs").select("*").order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setJobs(data as BookingJob[]);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function cancel(id: string) {
    const { error } = await supabase.from("booking_jobs").update({ status: "cancelled" }).eq("id", id);
    if (error) setError(error.message);
    load();
  }

  async function copy(link: string) {
    await navigator.clipboard.writeText(inviteUrl(link));
    setCopied(link);
  }

  if (!jobs.length) return <p className="muted">No bookings scheduled yet.</p>;

  return (
    <div className="stack">
      {error && <p className="error">{error}</p>}
      {jobs.map((j) => (
        <article key={j.id} className="card job">
          <header>
            <span className={`badge ${j.status}`}>{STATUS_LABEL[j.status]}</span>
            {j.dry_run && <span className="badge cancelled">Dry run</span>}
            <strong>{j.facility_name}</strong> · {j.complex_name}
          </header>
          <dl>
            <dt>Wanted</dt>
            <dd>{formatDate(j.target_date)} · {hourLabel(j.pref_from)}–{hourLabel(j.pref_to)} start</dd>
            <dt>Watching</dt>
            <dd>
              {formatBucharest(j.start_at)} → {formatBucharest(j.give_up_at)} · {j.attempts} checks
              {j.booking_attempts > 0 && `, ${j.booking_attempts} booking tries`}
            </dd>
            {j.first_free_seen_at && (
              <>
                <dt>Day opened</dt>
                <dd>first free hour seen {formatBucharest(j.first_free_seen_at)}</dd>
              </>
            )}
            {j.booked_hour !== null && (
              <>
                <dt>{j.status === "simulated" ? "Would book" : "Booked"}</dt>
                <dd><strong>{formatDate(j.target_date)} {hourLabel(j.booked_hour)}–{hourLabel(j.booked_hour + 1)}</strong></dd>
              </>
            )}
            {j.invite_link && (
              <>
                <dt>Invite</dt>
                <dd>
                  <a href={inviteUrl(j.invite_link)} target="_blank" rel="noreferrer">{inviteUrl(j.invite_link)}</a>{" "}
                  <button className="link" onClick={() => copy(j.invite_link!)}>{copied === j.invite_link ? "Copied" : "Copy"}</button>
                </dd>
              </>
            )}
            {j.result_message && (
              <>
                <dt>Message</dt>
                <dd>{j.result_message}</dd>
              </>
            )}
          </dl>
          {j.status === "pending" && <button className="secondary" onClick={() => cancel(j.id)}>Cancel job</button>}
        </article>
      ))}
    </div>
  );
}
