/**
 * Unit tests for the IoC container.
 *
 * Coverage targets (per the test-architect contract):
 *   - Token identity: two `token('X')` calls produce distinct symbols.
 *   - Resolution lifetimes: singleton caches, transient does not, scoped
 *     caches per scope and is unresolvable from the root.
 *   - Error paths: ServiceResolutionError ('unbound' / 'scoped-at-root'),
 *     DuplicateRegistrationError.
 *   - Factory contract: factories receive a Resolver and can resolve
 *     dependencies registered earlier.
 *   - Scope inheritance: singletons + transients delegate to parent;
 *     scoped instances are owned per scope.
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
const REQUEST_ID = token<string>('RequestId');

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
    // Resolver should not expose register* — verify at runtime since
    // the type-system check is at compile time.
    expect((captured as unknown as Record<string, unknown>).registerSingleton).toBeUndefined();
  });
});

describe('ServiceContainer.registerTransient', () => {
  it('runs the factory on every resolve', () => {
    const c: ServiceContainer = createContainer();
    let counter = 0;
    c.registerTransient(
      LOGGER,
      () => ({ log: () => undefined, _i: ++counter }) as unknown as Logger,
    );
    c.resolve(LOGGER);
    c.resolve(LOGGER);
    c.resolve(LOGGER);
    expect(counter).toBe(3);
  });
});

describe('ServiceContainer.registerScoped', () => {
  it('rejects resolution from the root container', () => {
    const c: ServiceContainer = createContainer();
    c.registerScoped(REQUEST_ID, () => 'irrelevant');
    expect(() => c.resolve(REQUEST_ID)).toThrowError(ServiceResolutionError);
    try {
      c.resolve(REQUEST_ID);
    } catch (e) {
      expect((e as ServiceResolutionError).reason).toBe('scoped-at-root');
    }
  });

  it('returns the same instance across resolves within one scope', () => {
    const c: ServiceContainer = createContainer();
    c.registerScoped(REQUEST_ID, () => `req-${Math.random()}`);
    const scope = c.createScope();
    const a = scope.resolve(REQUEST_ID);
    const b = scope.resolve(REQUEST_ID);
    expect(a).toBe(b);
  });

  it('returns a different instance per scope', () => {
    const c: ServiceContainer = createContainer();
    let i = 0;
    c.registerScoped(REQUEST_ID, () => `req-${++i}`);
    const aScope = c.createScope().resolve(REQUEST_ID);
    const bScope = c.createScope().resolve(REQUEST_ID);
    expect(aScope).not.toBe(bScope);
  });
});

describe('ScopedContainer inheritance', () => {
  it('delegates singleton resolution to the parent (one shared instance)', () => {
    const c: ServiceContainer = createContainer();
    c.registerSingleton(LOGGER, () => ({ log: () => undefined }));
    const fromRoot = c.resolve(LOGGER);
    const fromScope = c.createScope().resolve(LOGGER);
    expect(fromRoot).toBe(fromScope);
  });

  it('delegates transient resolution to the parent (factory runs each time)', () => {
    const c: ServiceContainer = createContainer();
    let i = 0;
    c.registerTransient(LOGGER, () => ({ log: () => undefined, _i: ++i }) as unknown as Logger);
    const scope = c.createScope();
    scope.resolve(LOGGER);
    scope.resolve(LOGGER);
    expect(i).toBe(2);
  });

  it('throws ServiceResolutionError for unbound tokens', () => {
    const c: ServiceContainer = createContainer();
    const scope = c.createScope();
    const TOK: ServiceToken<unknown> = token('Missing');
    expect(() => scope.resolve(TOK)).toThrowError(ServiceResolutionError);
    expect(scope.tryResolve(TOK)).toBeUndefined();
  });
});

describe('ServiceContainer error paths', () => {
  it('resolve() throws ServiceResolutionError("unbound") for unknown tokens', () => {
    const c: ServiceContainer = createContainer();
    const TOK: ServiceToken<unknown> = token('Unknown');
    try {
      c.resolve(TOK);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ServiceResolutionError);
      expect((e as ServiceResolutionError).reason).toBe('unbound');
      expect((e as ServiceResolutionError).tokenDescription).toBe('Unknown');
      expect((e as Error).message).toContain('"Unknown"');
    }
  });

  it('tryResolve() returns undefined for unknown tokens (does not throw)', () => {
    const c: ServiceContainer = createContainer();
    expect(c.tryResolve(token<string>('Nope'))).toBeUndefined();
  });

  it('register* rejects re-registration of the same token', () => {
    const c: ServiceContainer = createContainer();
    c.registerSingleton(LOGGER, () => ({ log: () => undefined }));
    expect(() => c.registerSingleton(LOGGER, () => ({ log: () => undefined }))).toThrowError(
      DuplicateRegistrationError,
    );
    expect(() => c.registerTransient(LOGGER, () => ({ log: () => undefined }))).toThrowError(
      DuplicateRegistrationError,
    );
    expect(() => c.registerScoped(LOGGER, () => ({ log: () => undefined }))).toThrowError(
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
