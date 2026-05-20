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

## 5. Security

- Never hard-code secrets / credentials / tokens / API keys — use environment
  variables or a secrets manager.
- Validate and sanitize all external input (user input, request bodies,
  environment variables, file contents).
- Do not build SQL / shell commands by string concatenation — use
  parameterized queries or safe APIs.
- Apply least privilege; never log sensitive data (passwords, tokens, PII).
- Keep dependencies minimal; do not add a dependency for a trivial task.

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
