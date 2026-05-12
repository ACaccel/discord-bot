/**
 * Plugin barrel.
 *
 * Bot composition roots import from this barrel via the `@plugins`
 * alias so a `bot.use(AutoReplyPlugin)` line stays a single readable
 * statement. Internal plugin modules continue to import each other by
 * relative path; only the public-facing plugin exports surface here.
 */
export { AutoReplyPlugin } from './auto-reply';
export { TtsReplyPlugin } from './tts-reply';
export { createGuildEventsPlugin, type GuildEventsConfig } from './guild-events';
export { createGiveawayPlugin, type GiveawayPluginConfig } from './giveaway';
export { createActivityPlugin, type ActivityPluginConfig } from './activity';
export { createMessageBackupPlugin, type MessageBackupPluginConfig } from './message-backup';
export { createLlmChatPlugin, type LlmChatPluginConfig } from './llm-chat';
