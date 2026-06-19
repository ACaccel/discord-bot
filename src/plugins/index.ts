/**
 * Plugin barrel.
 *
 * Bot composition roots import from this barrel via the `@plugins`
 * alias so a `bot.use(AutoReplyPlugin)` line stays a single readable
 * statement. Internal plugin modules continue to import each other by
 * relative path; only the public-facing plugin exports surface here.
 */
export { AutoReplyPlugin } from './auto-reply';
export { createGuildEventsPlugin } from './guild-events';
export { createGiveawayPlugin } from './giveaway';
export { createTempRolePlugin } from './temp-role';
export { createActivityPlugin } from './activity';
export { createMessageBackupPlugin, type MessageBackupPluginConfig } from './message-backup';
export { createLlmChatPlugin, type LlmChatPluginConfig } from './llm-chat';
export { createVoicePlugin } from './voice/plugin';
export { createEarthquakePlugin, type EarthquakePluginConfig } from './earthquake';
export { createLlmAutoReplyPlugin, type LlmAutoReplyPluginConfig } from './llm-auto-reply';
export {
  createSocialLinkPreviewPlugin,
  type SocialLinkPreviewPluginConfig,
} from './social-link-preview';
export { createSettingsApiPlugin, type SettingsApiPluginConfig } from './settings-api';
export { createIdentitySyncPlugin, type IdentitySyncPluginConfig } from './identity-sync';
