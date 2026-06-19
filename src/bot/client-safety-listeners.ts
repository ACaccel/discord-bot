/**
 * Discord `Client` connection-layer safety net.
 *
 * discord.js's `Client` is an EventEmitter, and Node rethrows an emitted
 * `'error'` event that has no listener as an `uncaughtException`. A
 * transient gateway socket reset (ECONNRESET / "socket hang up") would
 * therefore crash the entire process. Attaching these listeners keeps
 * such transient connectivity failures observable while discord.js runs
 * its own reconnection — the bot stays up across a momentary blip.
 *
 * Installed once by {@link BaseBot}, alongside the process-level safety
 * net, NOT by {@link ClientEventBridge}: the bridge attaches only after
 * the plugin host starts and detaches on shutdown, so it cannot cover
 * the login or teardown windows. This safety net must live for the
 * client's full lifecycle.
 */
import { Events } from 'discord.js';
import type { Client } from 'discord.js';

import type { Logger } from '../core/logger';

export interface InstallClientSafetyListenersInput {
  readonly client: Client;
  readonly logger: Logger;
}

/**
 * Attach non-fatal listeners for the Discord client's connection-error
 * and shard-lifecycle events. Every handler only logs — none throws and
 * none tears the client down; discord.js owns reconnection.
 */
export const installClientSafetyListeners = (
  input: InstallClientSafetyListenersInput,
): void => {
  const { client, logger } = input;

  client.on(Events.Error, (error) => {
    logger.error(
      { err: error },
      'discord client error (non-fatal; discord.js handles reconnection)',
    );
  });

  client.on(Events.ShardError, (error, shardId) => {
    logger.error(
      { err: error, shardId },
      'discord shard error (non-fatal; discord.js handles reconnection)',
    );
  });

  client.on(Events.ShardDisconnect, (closeEvent, shardId) => {
    logger.warn(
      { shardId, code: closeEvent.code, reason: closeEvent.reason },
      'discord shard disconnected (discord.js will attempt to reconnect)',
    );
  });
};
