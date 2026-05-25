/**
 * Manual IoC container for the discord-bot.
 *
 * Why hand-rolled and not Inversify / tsyringe / NestJS:
 *   - No reflect-metadata, no decorators, no class-emit gymnastics.
 *   - The implementation fits in this file and is debuggable in isolation.
 *   - At this project's scale a DI framework adds more surface than it
 *     removes; this module is the deliberate alternative.
 *
 * Public surface:
 *   - {@link ServiceToken} + {@link token}: typed handles with symbol
 *     identity (collision-proof) and an invariant phantom field so
 *     `ServiceToken<Dog>` is not assignable to `ServiceToken<Animal>`.
 *   - {@link Resolver}: read-only side, the only thing factories receive.
 *   - {@link ServiceContainer}: read + register, owned by composition roots.
 *   - {@link ScopedContainer}: returned by `createScope()`; resolves from
 *     itself for `scoped`, falls back to parent for everything else, and
 *     deliberately exposes no `register*` methods (that would silently
 *     shadow parent registrations).
 *
 * Service-locator guard:
 *   Only composition roots (`src/bot/**`) and tests are allowed to
 *   import this module. ESLint's `no-restricted-imports` enforces this so
 *   `application/`, `domain/`, `interface/`, `persistence/`, `infra/` may
 *   not call `container.resolve()` directly — they receive dependencies
 *   via constructor parameters.
 */

/**
 * Opaque, type-safe handle for a single service binding.
 *
 * The phantom is in a function position so `T` is invariant — without
 * this, `ServiceToken<SubT>` would be structurally assignable to
 * `ServiceToken<SuperT>` and a Dog factory could be resolved through an
 * Animal token. The phantom is `?` so it never has to be set at runtime.
 */
export interface ServiceToken<T> {
  readonly symbol: symbol;
  readonly description: string;
  /** Invariance brand. Never set at runtime. */
  readonly __brand?: (value: T) => T;
}

/**
 * Construct a fresh {@link ServiceToken}. Each call mints a unique
 * `Symbol`; tokens are compared by symbol identity, not by description.
 *
 * @param description Human-readable label used in error messages and
 *   `Symbol(description)`. Pick something searchable (e.g. `'Logger'`,
 *   `'MessageRepoFactory'`).
 */
export const token = <T>(description: string): ServiceToken<T> => ({
  symbol: Symbol(description),
  description,
});

/**
 * Read-only side of the container. Factories receive a `Resolver`, not a
 * full {@link ServiceContainer}, so they cannot accidentally register
 * extra bindings during construction (which would be order-dependent and
 * hide the dependency graph).
 */
export interface Resolver {
  /** Resolve `t` or throw {@link ServiceResolutionError}. */
  resolve<T>(t: ServiceToken<T>): T;
  /** Resolve `t` or return undefined when unbound. */
  tryResolve<T>(t: ServiceToken<T>): T | undefined;
}

export type ServiceFactory<T> = (resolver: Resolver) => T;

/**
 * Register-and-resolve container. Owned by composition roots.
 *
 * Lifetimes:
 *   - **singleton**: factory runs at most once per container; result is
 *     cached on the container that registered it.
 *   - **transient**: factory runs every `resolve()`.
 *   - **scoped**: factory runs once per {@link ScopedContainer}; the root
 *     container itself never caches a scoped service (resolving a scoped
 *     token at root level throws to surface the misuse).
 */
export interface ServiceContainer extends Resolver {
  registerSingleton<T>(t: ServiceToken<T>, factory: ServiceFactory<T>): void;
  registerTransient<T>(t: ServiceToken<T>, factory: ServiceFactory<T>): void;
  registerScoped<T>(t: ServiceToken<T>, factory: ServiceFactory<T>): void;
  /**
   * Create a child resolver that owns its own scoped-instance cache.
   * Singleton and transient resolutions delegate to the parent so a
   * single shared logger/clock/etc. survives across scopes.
   */
  createScope(): ScopedContainer;
}

/**
 * Resolver returned by {@link ServiceContainer.createScope}. No
 * `register*` methods — adding bindings inside a scope would create
 * silent fork-in-the-graph bugs, and scoped lifetime is the only
 * legitimate per-scope concept.
 */
export type ScopedContainer = Resolver;

/**
 * Thrown when {@link Resolver.resolve} is called for an unbound token,
 * or when a scoped token is resolved against the root container.
 *
 * Carries the token description so a missing binding shows up as
 * `ServiceResolutionError: no binding for "MessageRepoFactory"` rather
 * than the unhelpful `Symbol()` default.
 */
export class ServiceResolutionError extends Error {
  public override readonly name = 'ServiceResolutionError';
  public readonly tokenDescription: string;
  public readonly reason: 'unbound' | 'scoped-at-root';

  constructor(tokenDescription: string, reason: 'unbound' | 'scoped-at-root') {
    super(
      reason === 'unbound'
        ? `ServiceResolutionError: no binding for "${tokenDescription}"`
        : `ServiceResolutionError: token "${tokenDescription}" is registered as scoped; resolve from a ScopedContainer (call createScope())`,
    );
    this.tokenDescription = tokenDescription;
    this.reason = reason;
  }
}

/**
 * Thrown when {@link ServiceContainer.registerSingleton} / `registerTransient`
 * / `registerScoped` is called twice for the same token. Re-registering
 * is almost always a programmer error (two composition steps both
 * believe they own the binding); this fails loudly.
 */
export class DuplicateRegistrationError extends Error {
  public override readonly name = 'DuplicateRegistrationError';
  public readonly tokenDescription: string;

  constructor(tokenDescription: string) {
    super(
      `DuplicateRegistrationError: token "${tokenDescription}" is already registered. Re-registration is not allowed; use a separate container or rebind via a child scope.`,
    );
    this.tokenDescription = tokenDescription;
  }
}

type Lifetime = 'singleton' | 'transient' | 'scoped';

interface Binding<T> {
  readonly lifetime: Lifetime;
  readonly factory: ServiceFactory<T>;
}

/**
 * Default {@link ServiceContainer} implementation.
 *
 * Singleton cache lives on the root instance; scoped caches live on the
 * {@link DefaultScopedContainer} produced by `createScope`. Transients
 * are not cached.
 */
export class DefaultServiceContainer implements ServiceContainer {
  private readonly bindings = new Map<symbol, Binding<unknown>>();
  private readonly singletonCache = new Map<symbol, unknown>();

  public registerSingleton<T>(t: ServiceToken<T>, factory: ServiceFactory<T>): void {
    this.assertNotRegistered(t);
    this.bindings.set(t.symbol, { lifetime: 'singleton', factory });
  }

  public registerTransient<T>(t: ServiceToken<T>, factory: ServiceFactory<T>): void {
    this.assertNotRegistered(t);
    this.bindings.set(t.symbol, { lifetime: 'transient', factory });
  }

  public registerScoped<T>(t: ServiceToken<T>, factory: ServiceFactory<T>): void {
    this.assertNotRegistered(t);
    this.bindings.set(t.symbol, { lifetime: 'scoped', factory });
  }

  public resolve<T>(t: ServiceToken<T>): T {
    const value = this.tryResolve(t);
    if (value === undefined) {
      const binding = this.bindings.get(t.symbol);
      if (binding?.lifetime === 'scoped') {
        throw new ServiceResolutionError(t.description, 'scoped-at-root');
      }
      throw new ServiceResolutionError(t.description, 'unbound');
    }
    return value;
  }

  public tryResolve<T>(t: ServiceToken<T>): T | undefined {
    const binding = this.bindings.get(t.symbol);
    if (binding === undefined) return undefined;

    switch (binding.lifetime) {
      case 'singleton': {
        if (!this.singletonCache.has(t.symbol)) {
          this.singletonCache.set(t.symbol, binding.factory(this.resolverView()));
        }
        return this.singletonCache.get(t.symbol) as T;
      }
      case 'transient':
        return binding.factory(this.resolverView()) as T;
      case 'scoped':
        // Scoped resolution is only valid via a ScopedContainer; surface
        // misuse as undefined here so resolve() can throw a precise
        // 'scoped-at-root' error.
        return undefined;
    }
  }

  /**
   * Returns a Resolver view of this container — `register*` and
   * `createScope` are absent at runtime, not just at compile time.
   * Defense-in-depth against `@ts-ignore`d factories.
   */
  private resolverView(): Resolver {
    return {
      resolve: this.resolve.bind(this),
      tryResolve: this.tryResolve.bind(this),
    };
  }

  public createScope(): ScopedContainer {
    // Closures capture private state so the scoped container can read
    // bindings without the root container exposing a public accessor —
    // closing the only structural escape hatch around the layer guard.
    const getBinding = <T>(t: ServiceToken<T>): Binding<T> | undefined =>
      this.bindings.get(t.symbol) as Binding<T> | undefined;
    const delegateTryResolve = <T>(t: ServiceToken<T>): T | undefined => this.tryResolve(t);
    return new DefaultScopedContainer(getBinding, delegateTryResolve);
  }

  private assertNotRegistered<T>(t: ServiceToken<T>): void {
    if (this.bindings.has(t.symbol)) {
      throw new DuplicateRegistrationError(t.description);
    }
  }
}

class DefaultScopedContainer implements ScopedContainer {
  private readonly scopedCache = new Map<symbol, unknown>();

  constructor(
    private readonly getBinding: <T>(t: ServiceToken<T>) => Binding<T> | undefined,
    private readonly delegateTryResolve: <T>(t: ServiceToken<T>) => T | undefined,
  ) {}

  public resolve<T>(t: ServiceToken<T>): T {
    const value = this.tryResolve(t);
    if (value === undefined) {
      throw new ServiceResolutionError(t.description, 'unbound');
    }
    return value;
  }

  public tryResolve<T>(t: ServiceToken<T>): T | undefined {
    const binding = this.getBinding(t);
    if (binding === undefined) return undefined;

    if (binding.lifetime === 'scoped') {
      if (!this.scopedCache.has(t.symbol)) {
        this.scopedCache.set(t.symbol, binding.factory(this));
      }
      return this.scopedCache.get(t.symbol) as T;
    }

    // Singleton + transient delegate to the parent so a shared
    // logger/clock/etc. survives across scopes.
    return this.delegateTryResolve(t);
  }
}

/**
 * Convenience factory for the default container. Preferred over `new`
 * at call sites so the implementation type stays an internal detail and
 * future swaps (test doubles, instrumented containers) are local.
 */
export const createContainer = (): ServiceContainer => new DefaultServiceContainer();
