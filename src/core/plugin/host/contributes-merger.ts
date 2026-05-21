/**
 * Build the effective per-handler-type registries by merging the
 * codegen-shipped `coreRegistries` with each enabled plugin's
 * `contributes` block. Pure function over the host's registration map
 * + topological order.
 *
 * The merge is delegated to `mergeRegistries`, which throws
 * `DuplicateContributionError` on a name collision and tags every
 * surviving entry with its origin (plugin id or `'core'`).
 */
import { type ContributionSource, mergeRegistries } from '../registries';
import type {
  ContributedRegistry,
  HandlerConstructor,
  PluginContributions,
  Plugin,
  PluginId,
} from '../types';

interface MergeEntry {
  readonly plugin: Pick<Plugin<unknown>, 'contributes'>;
}

export interface EffectiveRegistries {
  readonly commands: Readonly<Record<string, HandlerConstructor>>;
  readonly buttons: Readonly<Record<string, HandlerConstructor>>;
  readonly modals: Readonly<Record<string, HandlerConstructor>>;
  readonly selectMenus: Readonly<Record<string, HandlerConstructor>>;
  readonly reactions: Readonly<Record<string, HandlerConstructor>>;
}

export interface CoreRegistries {
  readonly commands?: ContributedRegistry;
  readonly buttons?: ContributedRegistry;
  readonly modals?: ContributedRegistry;
  readonly selectMenus?: ContributedRegistry;
  readonly reactions?: ContributedRegistry;
}

const sourcesFor = (
  pick: (c: PluginContributions) => ContributedRegistry | undefined,
  coreReg: ContributedRegistry | undefined,
  order: readonly PluginId[],
  registered: ReadonlyMap<PluginId, MergeEntry>,
): ContributionSource[] => {
  const sources: ContributionSource[] = [];
  if (coreReg !== undefined && Object.keys(coreReg).length > 0) {
    sources.push({ id: 'core', registry: coreReg });
  }
  for (const id of order) {
    const slot = registered.get(id);
    if (slot === undefined) continue;
    const reg = pick(slot.plugin.contributes ?? {});
    if (reg !== undefined && Object.keys(reg).length > 0) {
      sources.push({ id, registry: reg });
    }
  }
  return sources;
};

export const buildEffectiveRegistries = (
  order: readonly PluginId[],
  registered: ReadonlyMap<PluginId, MergeEntry>,
  coreRegistries: CoreRegistries,
): EffectiveRegistries => ({
  commands: mergeRegistries(
    'command',
    sourcesFor((c) => c.commands, coreRegistries.commands, order, registered),
  ),
  buttons: mergeRegistries(
    'button',
    sourcesFor((c) => c.buttons, coreRegistries.buttons, order, registered),
  ),
  modals: mergeRegistries(
    'modal',
    sourcesFor((c) => c.modals, coreRegistries.modals, order, registered),
  ),
  selectMenus: mergeRegistries(
    'select-menu',
    sourcesFor((c) => c.selectMenus, coreRegistries.selectMenus, order, registered),
  ),
  reactions: mergeRegistries(
    'reaction',
    sourcesFor((c) => c.reactions, coreRegistries.reactions, order, registered),
  ),
});
