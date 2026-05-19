/**
 * Topological-order + dependents-index helpers for `PluginHost`. Pure
 * functions over the registration map; no class state. Kahn's
 * algorithm with deterministic tie-breaking by `Map` iteration order.
 */
import type { Plugin, PluginId } from '../types';
import { PluginRegistrationError } from './errors';

/**
 * Minimum shape needed for topology calculation — only `plugin.dependencies`
 * is read. The full `RegisteredPlugin` from the host satisfies this.
 */
interface TopologyEntry {
  readonly plugin: Pick<Plugin<unknown>, 'dependencies'>;
}

/**
 * Kahn's algorithm. Throws `PluginRegistrationError('CIRCULAR_DEPENDENCY')`
 * on cycle. Determinism: ties broken by the `Map` insertion order, so
 * the caller's registration order determines siblings' relative
 * positions.
 */
export const topologicalOrder = (
  registered: ReadonlyMap<PluginId, TopologyEntry>,
): readonly PluginId[] => {
  const indegree = new Map<PluginId, number>();
  const adjacency = new Map<PluginId, PluginId[]>();
  for (const id of registered.keys()) {
    indegree.set(id, 0);
    adjacency.set(id, []);
  }
  for (const [id, entry] of registered) {
    for (const dep of entry.plugin.dependencies ?? []) {
      adjacency.get(dep.id)?.push(id);
      indegree.set(id, (indegree.get(id) ?? 0) + 1);
    }
  }

  const queue: PluginId[] = [];
  for (const id of registered.keys()) {
    if ((indegree.get(id) ?? 0) === 0) queue.push(id);
  }
  const out: PluginId[] = [];
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) break;
    out.push(next);
    for (const downstream of adjacency.get(next) ?? []) {
      const decremented = (indegree.get(downstream) ?? 0) - 1;
      indegree.set(downstream, decremented);
      if (decremented === 0) {
        queue.push(downstream);
      }
    }
  }

  if (out.length !== registered.size) {
    const remaining = [...registered.keys()].filter((id) => !out.includes(id));
    throw new PluginRegistrationError(
      'CIRCULAR_DEPENDENCY',
      `PluginHost.finalizeRegistration: circular dependency among plugins [${remaining.join(', ')}].`,
    );
  }
  return Object.freeze(out);
};

/**
 * Forward-edge index: for each plugin id, the set of plugins that
 * named it as a dependency. Walked by the cascade-disable path when
 * a dependency fails.
 */
export const buildDependentsIndex = (
  registered: ReadonlyMap<PluginId, TopologyEntry>,
): Map<PluginId, Set<PluginId>> => {
  const out = new Map<PluginId, Set<PluginId>>();
  for (const id of registered.keys()) {
    out.set(id, new Set());
  }
  for (const [id, entry] of registered) {
    for (const dep of entry.plugin.dependencies ?? []) {
      out.get(dep.id)?.add(id);
    }
  }
  return out;
};
