/**
 * Bootstrap logger wiring for the ops CLI.
 *
 * A one-shot ops tool must not pollute `logs/<bot>/...` with synthetic,
 * bot-less records. `createBootstrapLogger` honours both `LOG_DIR=''` and
 * the explicit `{ fileRouter: false }` toggle as ways to skip the file
 * sink; we set both so the behaviour is unambiguous and matches the
 * standalone tools this CLI replaces.
 */
import { createBootstrapLogger } from '../../../src/core/config';
import type { Logger } from '../../../src/core/logger';

export const bootstrapToolLogger = (component: string): Logger => {
  process.env['LOG_DIR'] = '';
  return createBootstrapLogger({ component }, { fileRouter: false });
};
