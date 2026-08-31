/**
 * EarthquakePlugin — owns the `/discord/earthquake` HTTP webhook and
 * the per-guild earthquake-alert broadcast.
 *
 * Assembled only by `nijika`. Its `start` hook stands up the Express
 * server; `onShutdown` closes it so
 * a fast restart does not leak the listening socket. The broadcast
 * logic lives in `internal/` so this file is lifecycle wiring only.
 *
 * Why a factory: the listen `port` is per-bot configuration captured
 * into the closure, mirroring the `createMessageBackupPlugin` pattern.
 */
import express, { type Express } from 'express';
import type { Server } from 'node:http';

import { TOKENS } from '../../bot/tokens';
import { closeServerBounded } from '../../core/http';
import { logError, logSystem } from '../../core/logger';
import type { Plugin } from '../../core/plugin';
import { broadcastEarthquakeAlert } from './internal';

const PLUGIN_ID = 'earthquake';
const PLUGIN_VERSION = '1.0.0';

/** Configuration for {@link createEarthquakePlugin}. */
interface EarthquakePluginConfig {
  /** TCP port the earthquake webhook server listens on. */
  readonly port: number;
}

/**
 * Build the earthquake plugin. The returned object is pure data; all
 * mutable state (the HTTP server handle) is captured in the closure.
 */
export const createEarthquakePlugin = (rawConfig: EarthquakePluginConfig): Plugin => {
  const config: EarthquakePluginConfig = { port: rawConfig.port };
  let server: Server | undefined;

  return {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,

    async start(ctx): Promise<void> {
      const client = ctx.resolve(TOKENS.DiscordClient);
      const registry = ctx.resolve(TOKENS.GuildRegistry);

      const app: Express = express();
      app.use(express.json());
      const router = express.Router();
      app.use('/discord', router);

      router.get('/', (_req, res) => {
        res.status(200).send('Hello World!');
      });

      router.post('/earthquake', (_req, res) => {
        logSystem(ctx.logger, 'Earthquake alert webhook received; broadcasting.');
        // Respond 200 immediately; the per-guild broadcast runs
        // detached. `broadcastEarthquakeAlert` isolates each guild's
        // failure internally, so a single async IIFE with a defensive
        // catch is enough to keep this off the unhandledRejection path.
        void (async () => {
          try {
            await broadcastEarthquakeAlert(client, registry, ctx.translator, ctx.logger);
          } catch (err: unknown) {
            logError(ctx.logger, null, err);
          }
        })();
        res.status(200).send('OK');
      });

      await new Promise<void>((resolve, reject) => {
        const listening = app.listen(config.port, () => {
          logSystem(ctx.logger, `earthquake webhook server is running on port ${config.port}`);
          // Startup is settled. A socket error from here on is a runtime
          // event, and `reject` would silently discard it against an
          // already-settled promise — swap in a logging handler.
          listening.removeListener('error', reject);
          listening.on('error', (err: Error) => logError(ctx.logger, null, err));
          resolve();
        });
        listening.on('error', reject);
        server = listening;
      });
    },

    async onShutdown(ctx): Promise<void> {
      if (server === undefined) return;
      const listening = server;
      server = undefined;
      await closeServerBounded(listening, () => {
        logSystem(
          ctx.logger,
          'earthquake webhook server did not close within the shutdown budget; continuing',
        );
      });
      logSystem(ctx.logger, 'earthquake webhook server closed');
    },
  };
};
