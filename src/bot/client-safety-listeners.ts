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

interface InstallClientSafetyListenersInput {
  readonly client: Client;
  readonly logger: Logger;
}

/**
 * Clients that already carry these listeners.
 *
 * Node warns at ten listeners on one emitter and then stops warning, so
 * a repeated install (a bot restarted in-process, a test that reuses a
 * client) silently multiplied every connection-error line. A `WeakSet`
 * keys off the client itself and lets a discarded client be collected.
 */
const guarded = new WeakSet<Client>();

/**
 * Attach non-fatal listeners for the Discord client's connection-error
 * and shard-lifecycle events. Every handler only logs — none throws and
 * none tears the client down; discord.js owns reconnection.
 *
 * Idempotent per client: a second call for the same client is a no-op.
 */
export const installClientSafetyListeners = (input: InstallClientSafetyListenersInput): void => {
  const { client, logger } = input;
  if (guarded.has(client)) return;
  guarded.add(client);

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
