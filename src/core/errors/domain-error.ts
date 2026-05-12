/**
 * Abstract base for every recoverable, business-meaningful error in the
 * codebase. All concrete subclasses live in this directory and the
 * subset shape is asserted by the structural contract here:
 *
 *   - `code`: stable machine-readable identifier (e.g. `'LLM_RATE_LIMITED'`).
 *     Consumers may switch on `code` for compensation logic; it is part
 *     of the public API and changes follow SemVer.
 *   - `messageKey`: i18n catalog key for the user-facing translation.
 *     **Required** — the interaction outermost-catch must always be able
 *     to render a string without a fallback branch. Use real keys even
 *     for internal-only errors (e.g. `'errors.config.missing_env'`);
 *     they cost nothing and let the translator stay simple.
 *   - `messageParams`: ICU/i18next interpolation values for `messageKey`.
 *   - `context`: see {@link ErrorContext}. `operation` field required.
 *   - `cause`: the original Error preserved via ES2022 `Error.cause`.
 *     Pino serialises it natively.
 *
 * Subclass rules:
 *   - Override the `kind` discriminant string with the subclass name.
 *   - Hand-pick a default `messageKey` per subclass; allow override.
 *   - Never add ad-hoc fields outside `context` — every additional
 *     attribute weakens the redactor's job. If a field deserves
 *     first-class typing, promote it to a typed subclass.
 *
 * Programmer-error rules:
 *   - Throw a native `TypeError` / `RangeError` etc. for invariant
 *     violations the user cannot recover from. `DomainError` is for
 *     expected failure modes only; do not subclass it for
 *     "this should never happen".
 */
import type { ErrorContext } from './error-context';

export interface DomainErrorInit<
  Code extends string,
  Params extends Readonly<Record<string, string | number>> | undefined = undefined,
> {
  readonly code: Code;
  readonly messageKey: string;
  readonly context: ErrorContext;
  readonly cause?: unknown;
  readonly messageParams?: Params;
}

export abstract class DomainError<
  Code extends string = string,
  Params extends Readonly<Record<string, string | number>> | undefined = undefined,
> extends Error {
  /** Discriminant for narrowing across the DomainError union. */
  public abstract readonly kind: string;
  public readonly code: Code;
  public readonly messageKey: string;
  public readonly context: ErrorContext;
  public readonly messageParams: Params;

  protected constructor(init: DomainErrorInit<Code, Params>) {
    super(`${init.code}: ${init.messageKey}`, { cause: init.cause });
    this.name = new.target.name;
    this.code = init.code;
    this.messageKey = init.messageKey;
    this.context = init.context;
    // Cast is the single place where Params's optionality is collapsed;
    // subclasses that omit `messageParams` get `undefined` as expected.
    this.messageParams = (init.messageParams ?? undefined) as Params;
  }

  /**
   * JSON shape consumed by the pino structured logger. Excludes the
   * native `stack` string (pino serialises it through `err`) and
   * preserves `cause` via the standard ES2022 property.
   */
  public toJSON(): Readonly<Record<string, unknown>> {
    return {
      name: this.name,
      kind: this.kind,
      code: this.code,
      messageKey: this.messageKey,
      messageParams: this.messageParams,
      context: this.context,
      cause: this.cause,
    };
  }
}
