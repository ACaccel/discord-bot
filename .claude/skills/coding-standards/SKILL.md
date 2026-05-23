---
name: coding-standards
description: General code-quality standards (derived from CLAUDE.md). Apply when writing or modifying any code — object-oriented / SRP design, when to use design patterns, naming, guard clauses, security, structured error messages, comments, testing discipline. Self-check against the list before delivering.
---

# Code Quality Standards (coding-standards)

Commercial-grade quality is a hard requirement, not an aspiration. Code
produced must be **correct, secure, maintainable**, and no lower than the
quality of the surrounding code. This skill covers general quality discipline
beyond the framework rules (see [`project-conventions`]).

## 1. Quality bar

- Production-ready: no prototype shortcuts — no hard-coded values that should
  be config, no missing error handling, no untyped public APIs, no copy-paste
  duplication, no `TODO` left in committed code.
- When time / scope / unclear requirements force a trade-off, **surface it
  explicitly** instead of silently shipping lower-quality code.

## 2. Object-oriented and modular design

- Single Responsibility (SRP): one class / module, one clear responsibility;
  do not mix unrelated logic in one file.
- Prefer composition over inheritance where it reduces coupling.
- Group related constants / types / utilities into dedicated modules.
- Avoid God classes and monolithic functions; keep functions short and
  focused — if a function needs a long explanation, split it.

## 3. Design patterns

- Apply a pattern only when the context is rich enough; do not introduce
  patterns prematurely for trivial logic.
- Welcome: Factory / Strategy / Repository / Observer / Decorator; Singleton
  only for stateless service registries or configuration holders.
- At each usage, add a short comment: which pattern and why it was chosen.

## 4. Readability

- Descriptive, unambiguous names (variables / functions / classes / files).
- Guard clauses / early returns over deep nesting; limit nesting depth.
- No magic numbers / magic strings — define named constants.
- Delete dead code, do not comment it out.

### Handler 行數規範

`src/handlers/<type>/<name>/index.ts` 必須遵守下列五點。新 handler 自第一行
程式碼起就套用，不留「未來再說」空間。

1. **`index.ts` 行數上限為 150 行**（含 import、含 JSDoc、含空行）。由
   `eslint.config.mjs` 的 `max-lines` 規則對 `src/handlers/**/*.ts` 強制執行，違規為 error。
2. **超出上限的 pure helper（純函式、不依賴 Discord 物件）必須抽到同目錄的獨立檔案**。
   檔名 kebab-case（例：`parse-range.ts`、`render-reactions.ts`），具名 `export`，
   不使用 `export default`。
3. **不可為了壓縮行數而把 Discord I/O、權限檢查、Translator 呼叫拆出 `index.ts`**。
   這四項是 handler 的本職：interaction input 抽取、guild / repos / 權限檢查、
   `bot.translator.t(...)` 呼叫、把 domain 結果組裝成 Discord 回覆物件。它們必須
   留在 `index.ts` 內。
4. **抽出的 helper 必須有對應單元測試**，置於 `test/unit/handlers/<name>/<helper>.test.ts`。
   純函式測試 happy path + 邊界 + error path；接受 Translator / Repos 的 helper
   注入 in-memory fake。
5. **helper 不可放在 `src/handlers/shared/` 或新增的共用目錄**——抽出的內容是該
   handler 的內部實作細節；若日後有第二個 handler 需要同一邏輯，再評估是否上提。

## 5. Security

- Never hard-code secrets / credentials / tokens / API keys — use environment
  variables or a secrets manager.
- Validate and sanitize all external input (user input, request bodies,
  environment variables, file contents).
- Do not build SQL / shell commands by string concatenation — use
  parameterized queries or safe APIs.
- Apply least privilege; never log sensitive data (passwords, tokens, PII).
- Keep dependencies minimal; do not add a dependency for a trivial task.

> **Plugin 對 IoC 的依賴契約**：plugin 對 IoC 的依賴只能透過 `core/plugin` 取得
> （`import { TOKENS, type ServiceToken } from '<path>/core/plugin'`）。任何 `src/plugins/**` 對
> `core/ioc` 的直接 import 由 ESLint 在 lint 階段擋下。Plugin 可呼叫 `ctx.resolve(token)` 讀取依賴、
> 可在 `init` hook 內呼叫 `ctx.registerInstance(token, instance)` 註冊已建構的實例；不得透過任何
> 方式（包含對 `ctx` 強制 cast）取得 `ServiceContainer` 的寫入面 API。新 token 必須登錄在
> `src/core/ioc/tokens.ts` 中央目錄，再由 `core/plugin` 的 `TOKENS` re-export 自動曝露給 plugin。

## 6. Error handling

Error messages must be informative and actionable — an engineer reading the
message should locate the problem without tracing the call stack.

- Include context: the operation being performed, the input involved
  (sanitized), and what went wrong.
- Use structured error types / custom error classes, not raw strings.
- Do not swallow errors silently; if caught and not re-thrown, document why.
- Distinguish expected errors (validation failure, not-found) from unexpected
  errors (internal exceptions) and handle them separately.
- In async code, ensure every promise rejection is caught and handled.
- Good: `UserService.createUser failed: email "x@y.com" already exists`.
  Poor: `Error: failed`.

## 7. Testing discipline

The project already has test infrastructure (vitest, `test/`, a CI test job),
so **every code change must include corresponding test additions or updates**:

- New feature / function → new tests (happy path + meaningful edge cases).
- Bug fix → a regression test (fails before the fix, passes after).
- Refactor → update existing tests to reflect the new structure; do not delete
  tests merely because they break.
- Changing a public API / behavior → update all affected tests in the same
  change.
- Run the relevant test suite locally before declaring the task complete.

## 8. Comments

- Comments in English only, no emoji.
- Comment the *why* (intent, trade-offs, non-obvious decisions), not the *what*.
- Keep comments in sync with code; a misleading comment is worse than none.
- Use JSDoc for public APIs, exported functions, and class interfaces.

## 9. Post-writing self-check list

After producing any code, verify each item:

- [ ] No hard-coded secrets; external input validated
- [ ] One class / module, one responsibility; no God class / monolithic function
- [ ] Descriptive names; no magic number / string; guard clauses over deep nesting
- [ ] Error messages carry operation + input + cause; structured error types;
      no silent swallowing
- [ ] All async rejections handled
- [ ] This change ships with corresponding tests (new / updated / regression)
- [ ] Comments in English, explain why, no emoji; public APIs have JSDoc
- [ ] No leftover `TODO` / dead code / commented-out code
- [ ] Pattern usages carry a "which pattern + why" comment

Fix any failing item before delivering. Surface forced trade-offs explicitly.
