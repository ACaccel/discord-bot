import type { ResolveTargetsOutcome } from './resolve-targets';

/** A non-`ok` resolution outcome (failure variants are member-type free). */
export type RollCallFailure = Exclude<ResolveTargetsOutcome, { status: 'ok' }>;

/** A translator key plus optional interpolation params for a reply. */
export interface OutcomeReply {
  readonly key: string;
  readonly params?: Record<string, string | number>;
}

/**
 * Map a non-`ok` outcome to its translator key and params. Pure (no
 * translator), so the handler does a single `t(key, params)` and the mapping
 * is unit-testable on its own.
 */
export const rollCallOutcomeReply = (outcome: RollCallFailure): OutcomeReply => {
  switch (outcome.status) {
    case 'format_error':
      return { key: 'replies:roll_call.format_error' };
    case 'everyone_not_allowed':
      return { key: 'replies:roll_call.everyone_not_allowed' };
    case 'user_not_found':
      return { key: 'replies:roll_call.user_not_found', params: { id: outcome.id } };
    case 'role_no_members':
      return { key: 'replies:roll_call.role_no_members', params: { id: outcome.id } };
    case 'empty':
      return { key: 'replies:roll_call.no_valid_id' };
    case 'too_many':
      return {
        key: 'replies:roll_call.too_many_targets',
        params: { count: outcome.count, max: outcome.max },
      };
    default: {
      // Exhaustiveness guard: a new failure status fails the build here.
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
};
