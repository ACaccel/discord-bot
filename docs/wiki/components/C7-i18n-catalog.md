# C7 — i18n Catalog

## Responsibility

Pure data: `<lang>/{commands,errors,replies}.json` user-facing text catalogs. No code lives here. The `I18NextTranslator` in `src/core/i18n/` loads the catalogs via `loadCatalogResources`; composition roots inject the directory path explicitly.

## Layout

```
src/i18n/locales/
├── zh-TW/
│   ├── commands.json
│   ├── errors.json
│   └── replies.json
└── en/
    ├── commands.json
    ├── errors.json
    └── replies.json
```

Both locales must keep the same key set and the same `{{placeholder}}` set; this is enforced by the i18n test suite.

## Namespaces

- `commands.json` — per-command `description`, option `options.<opt>.description`, and `choices` keyed by stable `value`. Context-menu commands additionally provide `name`.
- `errors.json` — user-facing text for each `DomainError.messageKey`. Groups: `command`, `validation`, `permission`, `ai`, `db`, `llm`, `configuration`, plus a flat `unexpected` fallback.
- `replies.json` — every other command reply. Each command feature carries an in-character `<feature>.failed` fallback that interpolates `{{traceId}}`.

## Path injection

`LoadCatalogOptions.localesDir` is required. `src/core/i18n/` no longer derives the path from `__dirname`. The composition root owns the path via the helper `resolveLocalesDir()` in `src/bot/locales-dir.ts`; `BaseBot` accepts it through its constructor and `src/deploy.ts` reuses the same helper.

## Tests

- `yarn test:i18n` runs the catalog-completeness suite — key / placeholder parity across `zh-TW` and `en`.
- `test/i18n/catalog-runtime.test.ts` drives the real `loadCatalogResources` + `I18NextTranslator` pipeline against both locales and verifies missing-key fallback behavior.
