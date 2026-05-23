# C10 — Quality Gates

> 路徑：`CI workflow + tsconfig / eslint / vitest / package.json` ｜詳細設計：[`docs/design/C10-quality-gates.md`](../../design/C10-quality-gates.md) ｜任務：[`docs/tasks/C10-quality-gates.md`](../../tasks/C10-quality-gates.md)

## 職責

以 CI gate 橫切強制全 repo 品質：typecheck、lint、format、codegen drift、knip、test、coverage、CJK scanner、security、smoke。

## 現況

`refactor/architecture-overhaul` 已設 branch protection：全部 10 個 CI job
（`lint`、`typecheck`、`typecheck-emit`、`test-unit`、`test-coverage`、
`test-int`、`test-contract`、`knip`、`security`、`analyze`）為 required
status check；`strict: false`、不要求人工 review。repo 已啟用 GitHub
auto-merge，並以 `gh pr merge --auto --merge` 為**預設合併方式**。詳見設計檔
§2.8。

D8 已落地：`tsconfig.strict.json` 的 `include` 改為 `src/**/*`，strict
typecheck 涵蓋全 `src` 樹（含 `src/bot`、`src/handlers`、`src/plugins`、
`src/infra/discord`）；path alias 已補入 strict 設定。納入過程修正 `src/handlers`
的 `noUncheckedIndexedAccess` / `noUnusedParameters` 違規（行為等價）。

D3 已落地：`src/events/` 目錄已由 C8 刪除，CJK scanner（`test/i18n/no-literal-cjk.test.ts`）
的 `SCOPED_DIRECTORIES` 移除 `src/events` entry，現掃描 `src/handlers`、
`src/plugins`、`src/bot` 三目錄；`eslint.config.mjs` 的 service-locator guard
亦移除 stale 的 `src/events/**`、`src/features/**` glob。

## 近期變更

- 2026-05-24 — R4：`eslint.config.mjs` 新增 `src/handlers/**/*.ts` 的
  `max-lines` block（max 150、`skipBlankLines: false`、`skipComments: false`、
  違規 error）。`ignores` 顯式列入 `registry.generated.ts` 與三個框架/共用檔
  （`command.ts` / `discord-helpers.ts` / `reply-for-error.ts`）並附 inline
  comment 註明為 PR follow-up。CI lint 對 4 個示範 handler 由 red → green
  (tech-debt R4)
- 2026-05-24 — R3：`eslint.config.mjs` 新增 `src/plugins/**` 的
  `no-restricted-imports` block，禁止直接 import `core/ioc`；新增
  `test/unit/eslint/plugin-ioc-import-rule.test.ts` 程式化 ESLint
  fixture 鎖定這條規則的行為 (tech-debt R3)
- 2026-05-21 — D3 落地：CJK scanner `SCOPED_DIRECTORIES` 與 eslint
  service-locator guard 移除已刪除的 `src/events` / `src/features` 範圍。
- 2026-05-21 — D8 落地：strict tsconfig 涵蓋全 `src`，掃除 handler 嚴格模式違規。
- 2026-05-21 — 啟用 GitHub auto-merge 並定為預設合併方式（工程基礎建設）。
- 2026-05-21 — `refactor/architecture-overhaul` 加上 branch protection，
  10 個 CI job 設為 required status check（工程基礎建設）。
- 2026-05-21 — 建立元件 wiki 頁（工程基礎建設）。
