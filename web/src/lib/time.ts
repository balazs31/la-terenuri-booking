// All user-facing times are Europe/Bucharest, regardless of the browser's timezone.
const TZ = "Europe/Bucharest";

const pad = (n: number) => String(n).padStart(2, "0");

/** Today's date in Bucharest as YYYY-MM-DD, shifted by `days`. */
export function bucharestDate(days = 0): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return addDays(`${p.year}-${p.month}-${p.day}`, days);
}

/** YYYY-MM-DD shifted by `days`. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const r = new Date(Date.UTC(y, m - 1, d + days));
  return `${r.getUTCFullYear()}-${pad(r.getUTCMonth() + 1)}-${pad(r.getUTCDate())}`;
}

/** "Mon 19.10.2026" */
export function formatDate(date: string): string {
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" }).format(new Date(`${date}T12:00:00Z`));
  const [y, m, d] = date.split("-");
  return `${weekday} ${d}.${m}.${y}`;
}

export function formatBucharest(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, dateStyle: "medium", timeStyle: "medium" }).format(new Date(iso));
}

export const hourLabel = (h: number) => `${pad(h)}:00`;
