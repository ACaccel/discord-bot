/**
 * Extract Discord snowflake IDs (17-20 digits) from a free-form
 * input string, deduplicating while preserving first-seen order.
 * Returns an empty array when no candidates are found.
 */
export const parseIds = (raw: string): string[] => {
  const matches = raw.match(/\d{17,20}/g) ?? [];
  return Array.from(new Set(matches));
};
