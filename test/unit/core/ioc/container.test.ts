/**
 * Unit tests for the IoC container.
 *
 * Coverage targets (per the test-architect contract):
 *   - Token identity: two `token('X')` calls produce distinct symbols.
 *   - Singleton lifetime: the factory runs once and the result is cached.
 *   - Error paths: ServiceResolutionError, DuplicateRegistrationError.
 *   - Factory contract: factories receive a Resolver and can resolve
 *     dependencies registered earlier.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createContainer,
  token,
  DuplicateRegistrationError,
  ServiceResolutionError,
  type Resolver,
  type ServiceContainer,
  type ServiceToken,
} from '../../../../src/core/ioc/container';

interface Logger {
  log(msg: string): void;
}
interface Clock {
  now(): number;
}

const LOGGER = token<Logger>('Logger');
const CLOCK = token<Clock>('Clock');

describe('token()', () => {
  it('returns a distinct symbol per call even for identical descriptions', () => {
    const a = token<string>('Same');
    const b = token<string>('Same');
    expect(a.symbol).not.toBe(b.symbol);
    expect(a.description).toBe('Same');
  });
});

describe('ServiceContainer.registerSingleton', () => {
  it('caches the factory result and returns the same instance on subsequent resolves', () => {
    const c: ServiceContainer = createContainer();
    const factory = vi.fn<() => Logger>(() => ({ log: () => undefined }));
    c.registerSingleton(LOGGER, factory);

    const a = c.resolve(LOGGER);
    const b = c.resolve(LOGGER);
    expect(a).toBe(b);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('passes a Resolver (not the full container) to the factory', () => {
    const c: ServiceContainer = createContainer();
    c.registerSingleton(CLOCK, () => ({ now: () => 42 }));
    let captured: Resolver | undefined;
    c.registerSingleton(LOGGER, (resolver) => {
      captured = resolver;
      return { log: () => undefined };
    });
    c.resolve(LOGGER);

    expect(captured).toBeDefined();
    expect(captured?.resolve(CLOCK).now()).toBe(42);
    // Resolver should not expose registerSingleton — verify at runtime
    // since the type-system check is at compile time.
    expect((captured as unknown as Record<string, unknown>).registerSingleton).toBeUndefined();
  });
});

describe('ServiceContainer error paths', () => {
  it('resolve() throws ServiceResolutionError for unknown tokens', () => {
    const c: ServiceContainer = createContainer();
    const TOK: ServiceToken<unknown> = token('Unknown');
    try {
      c.resolve(TOK);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ServiceResolutionError);
      expect((e as ServiceResolutionError).tokenDescription).toBe('Unknown');
      expect((e as Error).message).toContain('"Unknown"');
    }
  });

  it('tryResolve() returns undefined for unknown tokens (does not throw)', () => {
    const c: ServiceContainer = createContainer();
    expect(c.tryResolve(token<string>('Nope'))).toBeUndefined();
  });

  it('registerSingleton rejects re-registration of the same token', () => {
    const c: ServiceContainer = createContainer();
    c.registerSingleton(LOGGER, () => ({ log: () => undefined }));
    expect(() => c.registerSingleton(LOGGER, () => ({ log: () => undefined }))).toThrowError(
      DuplicateRegistrationError,
    );
  });
});

describe('factory dependency resolution', () => {
  it('a factory can resolve a previously-registered token via the Resolver', () => {
    const c: ServiceContainer = createContainer();
    c.registerSingleton(CLOCK, () => ({ now: () => 1000 }));
    interface TimedLogger extends Logger {
      readonly clock: Clock;
    }
    const TIMED = token<TimedLogger>('TimedLogger');
    c.registerSingleton(TIMED, (r) => ({
      log: () => undefined,
      clock: r.resolve(CLOCK),
    }));
    expect(c.resolve(TIMED).clock.now()).toBe(1000);
  });
});
