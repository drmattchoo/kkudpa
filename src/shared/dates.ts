// Date and number helpers. DPA shows trip dates as dd/MM/yyyy (CE) and takes claim
// times as dd-MM-yyyy HH:mm in Buddhist Era. Thailand has no DST, so all arithmetic
// is done on "naive" timestamps: wall-clock time stored as if it were UTC.

const BE_OFFSET = 543;

const pad = (n: number) => String(n).padStart(2, '0');

/** Parse "dd-MM-yyyy HH:mm" (BE) into a naive timestamp in ms. */
export function parseBeDateTime(s: string): number {
  const m = /^\s*(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{2})\s*$/.exec(s);
  if (!m) throw new Error(`Not a DPA date-time (dd-MM-yyyy HH:mm, BE): "${s}"`);
  const [, d, mo, y, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  if (y < 2400) throw new Error(`Year ${y} looks like CE. DPA date-times must be Buddhist Era: "${s}"`);
  const t = Date.UTC(y - BE_OFFSET, mo - 1, d, h, mi);
  const back = new Date(t);
  if (back.getUTCDate() !== d || back.getUTCMonth() !== mo - 1 || h > 23 || mi > 59) {
    throw new Error(`Invalid date-time: "${s}"`);
  }
  return t;
}

/** Format a naive timestamp as "dd-MM-yyyy HH:mm" (BE). */
export function formatBeDateTime(t: number): string {
  const d = new Date(t);
  return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear() + BE_OFFSET} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** CE ISO date "yyyy-mm-dd" + "HH:mm" -> naive timestamp. */
export function isoToNaive(dateIso: string, hhmm = '00:00'): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
  const t = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m || !t) throw new Error(`Bad date/time: ${dateIso} ${hhmm}`);
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +t[1]!, +t[2]!);
}

export function naiveToIsoDate(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function naiveToHhmm(t: number): string {
  const d = new Date(t);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** "10/11/2026" or "10/11/2569" -> "2026-11-10". Returns null if not a date. */
export function parseSlashDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (!m) return null;
  let y = +m[3]!;
  if (y > 2400) y -= BE_OFFSET;
  return `${y}-${pad(+m[2]!)}-${pad(+m[1]!)}`;
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/** "4,500.00" -> 4500. Returns null for empty or non-numeric text. */
export function parseMoney(s: string | null | undefined): number | null {
  if (s == null) return null;
  const cleaned = String(s).replace(/[,\s฿]|บาท/g, '');
  if (cleaned === '' || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** Round to satang (2 dp) without float drift. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function formatMoney(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
