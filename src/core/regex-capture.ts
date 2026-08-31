/**
 * Safe reads of regex capture groups.
 *
 * `RegExpMatchArray` is indexed as `string | undefined` under
 * `noUncheckedIndexedAccess`, which is correct — an optional group that
 * did not participate really is absent. A call site whose pattern makes
 * the group mandatory knows better than the type, but casting the
 * `undefined` away buys that knowledge at the price of silence: add a
 * `?` to the pattern later and an `undefined` flows downstream unchecked.
 * Reading through here keeps the invariant enforced instead — a missing
 * mandatory group raises, per the programmer-error convention in
 * `core/ids.ts`.
 */

/**
 * The `group`-th capture of `match`.
 *
 * @throws {TypeError} when the group did not participate in the match —
 * a mismatch between the pattern and the call site, not a runtime input
 * problem.
 */
export const requireCapture = (match: RegExpMatchArray, group: number): string => {
  const captured = match[group];
  if (captured === undefined) {
    throw new TypeError(
      `requireCapture: capture group ${group} did not participate in the match "${match[0]}"`,
    );
  }
  return captured;
};
