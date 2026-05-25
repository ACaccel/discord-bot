/**
 * Small pure formatting helpers shared by inspect_member_ids. Kept
 * together because each is a one-liner and they all answer the same
 * "render a possibly-missing primitive" question.
 */

const DEFAULT_TRUNCATE_AT = 3800;

export const fmtTimestamp = (date: Date | null | undefined): string => {
  if (!date) return 'N/A';
  const unix = Math.floor(date.getTime() / 1000);
  return `<t:${unix}:F> (<t:${unix}:R>)`;
};

export const toText = (value: unknown): string => {
  if (value === null || value === undefined) return 'N/A';
  if (typeof value === 'string' && value.trim() === '') return 'N/A';
  return String(value);
};

export const truncate = (text: string, max: number = DEFAULT_TRUNCATE_AT): string => {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
};
