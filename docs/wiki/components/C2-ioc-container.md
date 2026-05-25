# C2 — IoC Container

## Responsibility

A roughly 280-line hand-written IoC container that manages dependency lifetimes through typed `ServiceToken<T>` keys. Replaces the Service Locator anti-pattern: every consumer declares its dependencies explicitly and the container is the sole wiring point.

## Key files

- `src/core/ioc/container.ts` — `ServiceContainer` class with `registerSingleton`, `registerFactory`, `resolve`, and `tryResolve`. Throws `DuplicateRegistrationError` on re-registration and `ServiceResolutionError` on missing tokens.
- `src/core/ioc/tokens.ts` — central token catalog. Every token used by any plugin or handler must be declared here.
- `src/core/ioc/index.ts` — barrel exporting `createContainer`, `ServiceContainer`, the `token()` factory, and the container error types.

## Token surface to plugins

Plugins never import from `@core/ioc` directly. They obtain `TOKENS` and the `ServiceToken<T>` / `Resolver` types from the `@core/plugin` barrel, which re-exports the value `TOKENS` and the relevant types. The constructors `createContainer`, `ServiceContainer`, `token()`, and the container error types are deliberately not re-exported — they remain composition-root-only (`src/bot/**`) and test-only.

This boundary is enforced by an ESLint `no-restricted-imports` rule on `src/plugins/**` that bans direct imports of `core/ioc` and `@core/ioc`.

## Notes

`PluginInitContext.registerInstance(token, instance)` is a thin facade over `registerSingleton(token, () => instance)`. It is the only write path a plugin has into the container, and only during the `init` lifecycle phase. Two examples of singletons published this way: `TOKENS.VoiceController` (registered by `VoicePlugin`) and `TOKENS.ModelCatalog` (registered by `LlmChatPlugin`).
