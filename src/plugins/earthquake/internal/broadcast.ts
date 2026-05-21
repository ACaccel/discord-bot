/**
 * Earthquake-alert broadcast logic.
 *
 * For every guild that has both an `earthquake` channel and an
 * `earthquake` role configured, send the translated alert; per-guild
 * failures are isolated and logged with the guild id.
 */
import type { Channel, Client } from 'discord.js';

import type { GuildRegistry } from '../../../core/guild-registry';
import type { Translator } from '../../../core/i18n';
import { logError, type Logger } from '../../../core/logger';

/** Symbolic channel / role name looked up via the guild registry. */
const EARTHQUAKE = 'earthquake';

/**
 * Send the earthquake alert to a single guild's configured channel.
 * No-op when the channel is not sendable. Extracted as a named helper
 * so it is independently unit-testable.
 */
export const sendEarthquakeAlert = async (
  channel: Channel,
  earthquakeRoleId: string,
  translator: Translator | undefined,
): Promise<void> => {
  if (!channel.isSendable()) return;
  const message = translator?.t('replies:earthquake.alert', { role: earthquakeRoleId }) ?? '';
  if (message.length === 0) return;
  await channel.send(message);
};

/**
 * Broadcast the earthquake alert to every guild that has an
 * `earthquake` channel and role configured. Per-guild errors are
 * caught and funnelled into the structured logger so one guild's
 * failure never aborts the rest of the fan-out.
 */
export const broadcastEarthquakeAlert = async (
  client: Client,
  registry: GuildRegistry,
  translator: Translator | undefined,
  logger: Logger | undefined,
  clientId: string,
): Promise<void> => {
  const guildIds = [...client.guilds.cache.keys()];
  await Promise.all(
    guildIds.map(async (guildId) => {
      try {
        const channel = registry.getChannel(guildId, EARTHQUAKE);
        const role = registry.getRole(guildId, EARTHQUAKE);
        if (channel === undefined || role === undefined) return;
        await sendEarthquakeAlert(channel, role.id, translator);
      } catch (err: unknown) {
        logError(logger, clientId, guildId, err);
      }
    }),
  );
};
