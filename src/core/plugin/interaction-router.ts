/**
 * InteractionRouter — Chain-of-Responsibility middleware engine.
 *
 * Each middleware sees the `InteractionContext` and decides whether to
 * call `next()` (advance the chain) or short-circuit (skip remaining
 * middleware). Failure semantics:
 *   - A middleware that throws aborts the chain. The exception bubbles
 *     to the caller of `dispatch()` and is the caller's responsibility
 *     to translate into a user-facing reply (the outermost catch in
 *     BaseBot's interaction listener performs this translation in
 *     Phase 4b).
 *   - A middleware that completes without calling `next()` ends the
 *     chain cleanly — typical of permission gates or rate limiters
 *     that reply to the user directly.
 *
 * Construction is two-step:
 *   1. `new InteractionRouter()` — empty.
 *   2. `router.use(...)` — push middleware in execution order.
 *
 * Once `dispatch()` has been called, further `use()` calls still
 * affect future dispatches (the middleware list is mutable but
 * immutable per-dispatch — snapshot taken at dispatch entry).
 */
import type { InteractionContext, InteractionMiddleware } from './types';

/**
 * Thrown when `next()` is called a second time inside a middleware.
 * The chain is strictly linear; double-`next()` is a programmer error
 * that would otherwise silently corrupt later middleware state.
 */
export class DoubleNextError extends Error {
  public override readonly name = 'DoubleNextError';
  public readonly middlewareName: string;
  constructor(middlewareName: string) {
    super(`DoubleNextError: middleware "${middlewareName}" called next() more than once.`);
    this.middlewareName = middlewareName;
  }
}

export class InteractionRouter {
  private readonly middlewares: InteractionMiddleware[] = [];

  /** Append a middleware to the chain. Order matters. */
  public use(middleware: InteractionMiddleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  /** Snapshot of registered middleware (for diagnostics + tests). */
  public stack(): readonly InteractionMiddleware[] {
    return Object.freeze([...this.middlewares]);
  }

  /**
   * Run an interaction through the middleware chain. Resolves once
   * the chain settles (either by every middleware completing or by an
   * earlier middleware not calling `next`). Rejects with the original
   * error if any middleware throws.
   */
  public async dispatch(ctx: InteractionContext): Promise<void> {
    const stack = [...this.middlewares];

    const runAt = async (i: number): Promise<void> => {
      if (i >= stack.length) return;
      const mw = stack[i];
      if (mw === undefined) return;
      let nextCalls = 0;
      const next = async (): Promise<void> => {
        nextCalls += 1;
        if (nextCalls > 1) {
          throw new DoubleNextError(mw.name);
        }
        await runAt(i + 1);
      };
      await mw.run(ctx, next);
    };

    await runAt(0);
  }
}
