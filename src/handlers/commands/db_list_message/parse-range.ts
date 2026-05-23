/**
 * Pure helpers for db_list_message: turn the user-supplied `date`
 * (YYYY-MM-DD) and optional `hour` (0-23) into a local-time
 * `[startMs, endMs)` range. Returning `null` keeps the handler
 * surface free of throwing for input validation — the caller maps
 * `null` to the i18n `invalid_args` reply.
 */

const isValidDateString = (date: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(date);

const parseDateParts = (date: string): { year: number; month: number; day: number } | null => {
  if (!isValidDateString(date)) return null;
  const [y, m, d] = date.split('-').map((v) => Number(v));
  if (!y || !m || !d) return null;
  // Reject impossible calendar values (e.g. month=13, day=32) early so
  // callers get a single `null` signal instead of a JS Date silently
  // rolling over and producing a misleading range.
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { year: y, month: m, day: d };
};

export const parseStartEnd = (
  date: string,
  hour: number | null | undefined,
): { startMs: number; endMs: number } | null => {
  const parts = parseDateParts(date);
  if (!parts) return null;

  const { year, month, day } = parts;

  if (hour === null || hour === undefined) {
    const start = new Date(year, month - 1, day, 0, 0, 0, 0);
    const end = new Date(year, month - 1, day + 1, 0, 0, 0, 0);
    return { startMs: start.getTime(), endMs: end.getTime() };
  }

  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;

  const start = new Date(year, month - 1, day, hour, 0, 0, 0);
  const end = new Date(year, month - 1, day, hour + 1, 0, 0, 0);
  return { startMs: start.getTime(), endMs: end.getTime() };
};
