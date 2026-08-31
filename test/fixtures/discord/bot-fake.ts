/**
 * `BaseBot` stand-ins for handler-layer tests.
 *
 * A handler receives the whole `BaseBot` but reads a handful of fields
 * off it — usually `translator`, `logger`, and one of `config` /
 * `getGuildInfo` / `getRepos`. Building that by hand meant an
 * `as unknown as BaseBot` cast in every handler test file, each with a
 * slightly different logger stub.
 *
 * {@link buildFakeBot} owns the single cast. Call sites pass only the
 * fields their handler actually reads, which doubles as documentation
 * of the handler's real dependency surface.
 */
import { vi, type Mock } from 'vitest';

import type { BaseBot } from '../../../src/bot';

/**
 * Spy logger with the `child()` self-return the structured logger
 * contract requires, plus a direct handle on each level so a test can
 * assert what was logged.
 */
interface FakeLogger {
  readonly error: Mock;
  readonly warn: Mock;
  readonly info: Mock;
  readonly debug: Mock;
  readonly child: () => FakeLogger;
}

const buildFakeLogger = (): FakeLogger => {
  const logger: FakeLogger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    child: () => logger,
  };
  return logger;
};

/**
 * Translator stub that returns the key unchanged. Use it when the
 * assertion is "which key did the handler pick"; interpolation is not
 * part of that question.
 */
const echoTranslator = (): BaseBot['translator'] =>
  ({ t: (key: string) => key, tStrict: (key: string) => key }) as unknown as BaseBot['translator'];

/**
 * Translator stub that appends the interpolation params, so a test can
 * assert a placeholder was actually supplied a value. `separator`
 * exists because different suites already assert against `:` or `|`.
 */
export const echoTranslatorWithParams = (separator = ':'): BaseBot['translator'] =>
  ({
    t: (key: string, params?: Record<string, unknown>) =>
      params === undefined ? key : `${key}${separator}${JSON.stringify(params)}`,
    tStrict: (key: string) => key,
  }) as unknown as BaseBot['translator'];

/**
 * Build a `BaseBot` stand-in carrying `fields` plus a default echo
 * translator and a spy logger.
 *
 * `fields` is deliberately an open record: the point of the fixture is
 * to satisfy whatever narrow slice of `BaseBot` a handler reads, and
 * pinning it to `Partial<BaseBot>` would demand real `discord.js`
 * values the stubs neither have nor need. Pass `translator` to override
 * the default; the logger is always the returned spy.
 */
export const buildFakeBot = (
  fields: Readonly<Record<string, unknown>> = {},
): { readonly bot: BaseBot; readonly logger: FakeLogger } => {
  const logger = buildFakeLogger();
  return {
    logger,
    bot: {
      translator: echoTranslator(),
      ...fields,
      logger,
      requireLogger: () => logger,
    } as unknown as BaseBot,
  };
};
