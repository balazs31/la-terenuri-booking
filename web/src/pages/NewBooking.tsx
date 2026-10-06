import { useEffect, useState, type FormEvent } from "react";
import FreeSlots from "../components/FreeSlots";
import { supabase } from "../lib/supabase";
import { BOOKING_WINDOW_DAYS, COMPLEXES, FACILITIES, HOURS } from "../lib/catalog";
import { addDays, bucharestDate, formatDate, hourLabel } from "../lib/time";

interface Props {
  onCreated: () => void;
  onOpenSettings: () => void;
}

export default function NewBooking({ onCreated, onOpenSettings }: Props) {
  const [facilityId, setFacilityId] = useState(FACILITIES[0].id);
  const facility = FACILITIES.find((f) => f.id === facilityId)!;
  const complexes = COMPLEXES.filter((c) => facility.complexes.includes(c.id));
  const [chosenComplexId, setComplexId] = useState(COMPLEXES[0].id);
  // Keep the location valid when the sport changes (e.g. squash is only at La Terenuri).
  const complex = complexes.find((c) => c.id === chosenComplexId) ?? complexes[0];
  // Default: the day that opens at the next midnight.
  const [date, setDate] = useState(bucharestDate(BOOKING_WINDOW_DAYS + 1));
  const [from, setFrom] = useState(18);
  const [to, setTo] = useState(20);
  const [dryRun, setDryRun] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loginOk, setLoginOk] = useState<boolean | null>(null);

  useEffect(() => {
    supabase.from("terenuri_accounts").select("verified_at").maybeSingle()
      .then(({ data }) => setLoginOk(!!data?.verified_at));
  }, []);

  const today = bucharestDate();
  const releaseDate = date ? addDays(date, -BOOKING_WINDOW_DAYS) : "";
  const alreadyOpen = releaseDate <= today;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!date || date < today) return setError("Pick today or a later day.");
    if (to < from) return setError("The window's end can't be before its start.");
    setBusy(true);
    const { error } = await supabase.from("booking_jobs").insert({
      complex_id: complex.id,
      complex_name: complex.name,
      facility_id: facility.id,
      facility_name: facility.name,
      min_people: facility.minPeople,
      target_date: date,
      pref_from: from,
      pref_to: to,
      dry_run: dryRun,
    });
    setBusy(false);
    if (error) return setError(error.message);
    onCreated();
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h2>New booking</h2>
      {loginOk === false && (
        <p className="error">
          Your La Terenuri login isn't set up or tested yet.{" "}
          <button type="button" className="link" onClick={onOpenSettings}>Open Settings</button>
        </p>
      )}

      <div className="grid2">
        <label>
          Sport
          <select value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
            {FACILITIES.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        <label>
          Location
          <select value={complex.id} onChange={(e) => setComplexId(e.target.value)}>
            {complexes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>

      <FreeSlots facility={facility} complex={complex} />

      <h2 className="section">Schedule the bot</h2>
      <p className="muted small">For a day that isn’t open yet, or a full day you want watched.</p>
      <div className="grid3">
        <label>
          Day
          <input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label>
          From
          <select value={from} onChange={(e) => setFrom(Number(e.target.value))}>
            {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
          </select>
        </label>
        <label>
          To (last start hour)
          <select value={to} onChange={(e) => setTo(Number(e.target.value))}>
            {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
          </select>
        </label>
      </div>

      {date && (
        <p className="muted small">
          {alreadyOpen
            ? `${formatDate(date)} is already open on the site: the bot tries right away (for 10 minutes).`
            : `${formatDate(date)} opens at ${formatDate(releaseDate)} 00:00 (Romanian time). The bot logs in 2 minutes
               earlier, polls every second around the opening and keeps watching until 03:30.`}{" "}
          Books the earliest free hour from {hourLabel(from)} to {hourLabel(to)}; if none is free, the free hour closest to
          that window on the same day (the later one on a tie). The site allows one booking per sport per week
          {facility.minPeople > 1 && `, and ${facility.name.toLowerCase()} needs ${facility.minPeople - 1} more player(s) to confirm within 2 hours`}.
        </p>
      )}

      <label className="checkbox">
        <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
        Dry run: watch and pick an hour, but don’t book
      </label>

      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? "Saving…" : dryRun ? "Schedule dry run" : "Schedule booking"}</button>
    </form>
  );
}
