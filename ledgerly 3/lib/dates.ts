/** Date helpers pinned to India time, so reminders fire on the right day wherever the server runs. */

export type IST = { iso: string; year: number; month: number; day: number; dow: number };

export function todayIST(now: Date = new Date()): IST {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, year, month, day, dow };
}

export const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

export const isoOf = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(Math.min(d, daysInMonth(y, m))).padStart(2, "0")}`;

export const dayNumber = (iso: string) =>
  Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);

export const daysBetween = (fromIso: string, toIso: string) => dayNumber(toIso) - dayNumber(fromIso);

/** The next date on or after `from` that falls on `dueDay` of a month (clamped to short months). */
export function nextDue(dueDay: number, from: IST): string {
  const thisMonth = isoOf(from.year, from.month, dueDay);
  if (thisMonth >= from.iso) return thisMonth;
  const m = from.month === 12 ? 1 : from.month + 1;
  const y = from.month === 12 ? from.year + 1 : from.year;
  return isoOf(y, m, dueDay);
}

export function addMonths(iso: string, n: number): string {
  const y0 = +iso.slice(0, 4);
  const m0 = +iso.slice(5, 7) - 1 + n;
  const y = y0 + Math.floor(m0 / 12);
  const m = ((m0 % 12) + 12) % 12 + 1;
  return isoOf(y, m, +iso.slice(8, 10));
}
