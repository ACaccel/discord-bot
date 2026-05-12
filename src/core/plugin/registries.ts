/**
 * Pure registry merge — combines a core (codegen) handler registry
 * with every registered plugin's `contributes.<type>` map into a
 * single effective registry. Duplicate names throw with both sources
 * surfaced so an operator can resolve the conflict at register time.
 *
 * Lives separate from `host.ts` so it can be unit-tested without
 * spinning up plugins. The host calls it once per handler type at
 * register-completion time.
 */
import type { ContributedRegistry, HandlerConstructor, PluginId } from './types';

/**
 * Thrown when two sources contribute a handler under the same name.
 * Carries both source ids so the operator can decide which plugin to
 * remove or rename.
 */
export class DuplicateContributionError extends Error {
  public override readonly name = 'DuplicateContributionError';
  public readonly handlerType: string;
  public readonly handlerName: string;
  public readonly sources: readonly [string, string];

  constructor(handlerType: string, handlerName: string, sources: readonly [string, string]) {
    super(
      `DuplicateContributionError: ${handlerType} handler "${handlerName}" is contributed by both "${sources[0]}" and "${sources[1]}".`,
    );
    this.handlerType = handlerType;
    this.handlerName = handlerName;
    this.sources = sources;
  }
}

/**
 * One source of contributions. `id` is `'core'` for the codegen
 * registry and the plugin id otherwise — the value is reported in
 * {@link DuplicateContributionError.sources} so the operator can
 * tell at a glance whether the conflict is core-vs-plugin or
 * plugin-vs-plugin.
 */
export interface ContributionSource {
  readonly id: PluginId | 'core';
  readonly registry: ContributedRegistry;
}

/**
 * Merge `sources` left-to-right into one effective registry. The order
 * matters only for error reporting — duplicate names throw regardless
 * of position. Empty sources are skipped.
 *
 * @param handlerType e.g. `'command'`, `'button'` — used in the error message only.
 */
export const mergeRegistries = (
  handlerType: string,
  sources: readonly ContributionSource[],
): Readonly<Record<string, HandlerConstructor>> => {
  const out = new Map<string, HandlerConstructor>();
  const provenance = new Map<string, PluginId | 'core'>();

  for (const source of sources) {
    for (const [name, ctor] of Object.entries(source.registry)) {
      const existing = provenance.get(name);
      if (existing !== undefined) {
        throw new DuplicateContributionError(handlerType, name, [existing, source.id]);
      }
      out.set(name, ctor);
      provenance.set(name, source.id);
    }
  }

  return Object.freeze(Object.fromEntries(out));
};
