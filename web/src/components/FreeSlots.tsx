import { useCallback, useEffect, useState } from "react";
import { inviteUrl, supabase } from "../lib/supabase";
import type { Complex, Facility } from "../lib/catalog";
import { addDays, formatDate, hourLabel } from "../lib/time";

interface Day {
  date: string;
  free: number[];
  error?: string;
}

interface SlotsResponse {
  ok: boolean;
  message?: string;
  days?: Day[];
  weekCounts?: Record<string, number>;
}

interface BookResponse {
  ok: boolean;
  message: string;
  inviteLink?: string;
}

/** Monday of the ISO week, YYYY-MM-DD. */
function mondayOf(date: string): string {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, -((dow + 6) % 7));
}

interface Props {
  facility: Facility;
  complex: Complex;
}

/** Free hours of the days that are already open on the site, bookable right away. */
export default function FreeSlots({ facility, complex }: Props) {
  const [data, setData] = useState<SlotsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<{ date: string; hour: number } | null>(null);
  const [booking, setBooking] = useState(false);
  const [result, setResult] = useState<BookResponse | null>(null);

  const load = useCallback(async (signal?: { cancelled: boolean }) => {
    setLoading(true);
    setSelected(null);
    const { data, error } = await supabase.functions.invoke<SlotsResponse>("terenuri-direct", {
      body: { action: "slots", complexId: complex.id, facilityId: facility.id },
    });
    if (signal?.cancelled) return;
    setLoading(false);
    setData(error ? { ok: false, message: error.message } : data);
  }, [complex.id, facility.id]);

  useEffect(() => {
    const signal = { cancelled: false };
    setData(null);
    setResult(null);
    load(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [load]);

  async function bookSelected() {
    if (!selected) return;
    setBooking(true);
    setResult(null);
    const { data, error } = await supabase.functions.invoke<BookResponse>("terenuri-direct", {
      body: {
        action: "book",
        complexId: complex.id,
        complexName: complex.name,
        facilityId: facility.id,
        facilityName: facility.name,
        minPeople: facility.minPeople,
        date: selected.date,
        hour: selected.hour,
      },
    });
    setBooking(false);
    const r = error ? { ok: false, message: error.message } : data!;
    setResult(r);
    load();
  }

  const weekFull = (date: string) => (data?.weekCounts?.[mondayOf(date)] ?? 0) > 0;

  return (
    <section className="stack">
      <div className="row spread">
        <h2>Free now</h2>
        <button type="button" className="link" onClick={() => load()} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      {!data && loading && <p className="muted small">Checking the open days on the site…</p>}
      {data && !data.ok && <p className="error">{data.message}</p>}
      {data?.ok && data.days && (
        <ul className="days">
          {data.days.map((d) => (
            <li key={d.date}>
              <span className="day">{formatDate(d.date)}</span>
              <span className="hours">
                {d.error && <span className="error small">couldn’t load</span>}
                {!d.error && d.free.length === 0 && (
                  <span className="muted small">{weekFull(d.date) ? "you already have a booking this week" : "full"}</span>
                )}
                {d.free.map((h) => {
                  const active = selected?.date === d.date && selected.hour === h;
                  return (
                    <button
                      key={h}
                      type="button"
                      className={active ? "hour active" : "hour"}
                      onClick={() => setSelected(active ? null : { date: d.date, hour: h })}
                    >
                      {hourLabel(h)}
                    </button>
                  );
                })}
                {weekFull(d.date) && d.free.length > 0 && <span className="muted small">· you already booked this week</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <div className="row">
          <button type="button" onClick={bookSelected} disabled={booking}>
            {booking ? "Booking…" : `Book ${formatDate(selected.date)} ${hourLabel(selected.hour)} now`}
          </button>
          {weekFull(selected.date) && (
            <p className="error small">You already have a {facility.name.toLowerCase()} booking that week; the site will likely refuse.</p>
          )}
        </div>
      )}
      {result && (
        <p className={result.ok ? "info" : "error"}>
          {result.message}
          {result.ok && " It’s listed under Bookings."}
          {result.inviteLink && facility.minPeople > 1 && (
            <> Invite link for your partner (confirm within 2 h): <a href={inviteUrl(result.inviteLink)} target="_blank" rel="noreferrer">{inviteUrl(result.inviteLink)}</a></>
          )}
        </p>
      )}
    </section>
  );
}
