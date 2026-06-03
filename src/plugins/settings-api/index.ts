/**
 * Settings-api plugin barrel. Surfaces the factory + config type; the
 * HTTP wiring stays in `plugin.ts`.
 */
export {
  createSettingsApiPlugin,
  type CreateSettingsApiDeps,
  type SettingsApiPluginConfig,
} from './plugin';
