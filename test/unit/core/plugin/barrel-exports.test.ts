import { describe, expect, it } from 'vitest';
import { TOKENS, type Resolver, type ServiceToken } from '../../../../src/core/plugin';

/**
 * Plugins must reach the IoC layer only via the
 * `core/plugin` barrel. This test pins down the public surface so any
 * accidental removal of the re-export breaks at compile + test time.
 */
describe('core/plugin barrel — IoC re-exports', () => {
  it('re-exports the TOKENS map with the canonical plugin keys', () => {
    expect(TOKENS).toBeDefined();
    expect(TOKENS.Logger).toBeDefined();
    expect(TOKENS.ReposFactory).toBeDefined();
    expect(TOKENS.Translator).toBeDefined();
    expect(TOKENS.Clock).toBeDefined();
    expect(TOKENS.GuildRegistry).toBeDefined();
  });

  it('re-exports ServiceToken / Resolver as types usable at compile time', () => {
    // Compile-time assertion: the type aliases must be assignable from
    // the TOKENS table and a synthesised Resolver shape. If the
    // re-exports vanished, this file would fail to typecheck.
    const loggerToken: ServiceToken<unknown> = TOKENS.Logger as ServiceToken<unknown>;
    expect(loggerToken).toBe(TOKENS.Logger);

    const fakeResolver: Resolver = {
      resolve: <T>(token: ServiceToken<T>): T => {
        void token;
        return undefined as T;
      },
      tryResolve: <T>(token: ServiceToken<T>): T | undefined => {
        void token;
        return undefined;
      },
    };
    expect(typeof fakeResolver.resolve).toBe('function');
    expect(typeof fakeResolver.tryResolve).toBe('function');
  });

  it('does NOT re-export container write-side surface (composition-root privilege)', async () => {
    // Importing the barrel as an opaque record lets us assert that the
    // intentionally-withheld names are absent without tripping TS.
    const barrel = (await import('../../../../src/core/plugin')) as Record<string, unknown>;
    expect(barrel.createContainer).toBeUndefined();
    expect(barrel.DefaultServiceContainer).toBeUndefined();
    expect(barrel.token).toBeUndefined();
    expect(barrel.ServiceResolutionError).toBeUndefined();
    expect(barrel.DuplicateRegistrationError).toBeUndefined();
  });
});
