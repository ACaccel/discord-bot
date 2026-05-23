/**
 * Composition-root helper: resolve the deployed locales root.
 *
 * R5: `core/i18n` no longer reverse-resolves the content layer's
 * filesystem location. The composition root (this directory) owns
 * that knowledge and injects `localesDir` explicitly via
 * {@link createDefaultTranslator}.
 *
 * `__dirname` for this file is `<dist-or-src>/bot`, so one level up
 * lands on `<dist-or-src>` and `/i18n/locales` is the canonical
 * catalog root shared by every bot in this monorepo.
 */
import * as path from 'node:path';

/** Canonical locales root for every bot in this monorepo. */
export const resolveLocalesDir = (): string =>
  path.resolve(__dirname, '..', 'i18n', 'locales');
