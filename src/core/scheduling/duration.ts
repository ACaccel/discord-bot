/**
 * Duration-string parsing for scheduled features.
 *
 * Shared by the giveaway and activity plugins, which both accept a
 * human-typed duration (e.g. `30m`, `2h`, `1d`) and need it as a
 * millisecond offset for `JobManager` scheduling. A pure,
 * dependency-free helper.
 */

/** A supported single-character duration unit. */
type DurationUnit = 's' | 'm' | 'h' | 'd' | 'w';

/** Millisecond factor for each {@link DurationUnit}. */
const UNIT_TO_MS: Readonly<Record<DurationUnit, number>> = Object.freeze({
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
});

const DURATION_PATTERN = /^(\d+)([smhdw])$/;

/**
 * Parse a duration string of the form `<count><unit>` into milliseconds.
 *
 * @param duration - e.g. `"45s"`, `"30m"`, `"2h"`, `"7d"`, `"1w"`.
 * @returns the duration in milliseconds, or `null` when the input does
 *          not match the `<digits><unit>` grammar.
 */
export const parseDuration = (duration: string): number | null => {
  const match = DURATION_PATTERN.exec(duration);
  if (!match) return null;

  // A successful match of `^(\d+)([smhdw])$` guarantees group 1 is a
  // run of digits and group 2 is exactly one unit character. The
  // non-null assertions collapse the `string | undefined` that
  // `noUncheckedIndexedAccess` infers; `as DurationUnit` is sound
  // because the character class is the `DurationUnit` alphabet.
  const value = Number.parseInt(match[1]!, 10);
  const unit = match[2]! as DurationUnit;

  return value * UNIT_TO_MS[unit];
};
