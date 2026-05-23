# C3 — Plugin Runtime

> 路徑：`src/core/plugin/（含 host/）` ｜詳細設計：[`docs/design/C3-plugin-runtime.md`](../../design/C3-plugin-runtime.md) ｜任務：[`docs/tasks/C3-plugin-runtime.md`](../../tasks/C3-plugin-runtime.md)

## 職責

Plugin 架構微核心：定義 `Plugin<Config>` 契約並驅動生命週期、事件分派、InteractionRouter 路由。

## 現況

- D1（介面）已落地：`src/core/plugin/guild-onboarding-port.ts` 定義
  `GuildOnboardingPort`，封裝「連線新 guild DB」「註冊該 guild command」兩項能力；
  `TOKENS.GuildOnboardingPort` 已登錄。`BaseBot` 實作見 C11、plugin 消費見 C8。
- D6 已落地：lifecycle 邏輯抽至 `host/lifecycle.ts` 的 `PluginLifecycleRunner`，
  經窄介面 `LifecycleHost` 注入；`cascadeDisable` 移至 `host/topology.ts` 為純函式；
  `host.ts` 的 `initAll`/`startAll`/`readyAll`/`shutdownAll` 改為薄委派。

## 現況補充（R2 後）

- `PluginInitContext` 增補 `registerInstance<T>(token, instance)`
  facade，只在 `init` hook 合法；其他 lifecycle context（start /
  runtime / event）型別層即不暴露此方法。
- `PluginLifecycleRunner` 新增 `phase` 追蹤（`'idle' | 'init' |
'start' | 'ready' | 'running' | 'shutdown'`），`buildInitContext`
  的 `registerInstance` 閉包讀取執行時的 phase，使 plugin 偷藏 init
  ctx 到後續階段呼叫亦會被擋；違規拋 `ConfigurationError` with
  code `LIFECYCLE_PHASE_VIOLATION` + messageKey
  `errors:plugin.lifecycle_phase_violation`。
- `LifecycleHost` 介面新增唯一一條 `container: ServiceContainer`
  read-only 欄位，作為 runner 寫入 container 的單一通道；plugin 端
  仍只看到 typed-token resolver 與 `registerInstance` facade。

## 現況補充（R3 後）

- `src/core/plugin/index.ts` barrel 新增 `TOKENS` value re-export 與
  `ServiceToken` / `Resolver` type re-export，成為 plugin 端對
  `core/ioc` 的**唯一窗口**；`ServiceContainer` / `createContainer` /
  `token()` factory / 容器錯誤型別**刻意不**re-export，保留為
  composition root 專屬權限。
- 違規由 ESLint 在 lint 階段擋下（`src/plugins/**` 的
  `no-restricted-imports` 對 `core/ioc` 群組）。

## 近期變更

- 2026-05-24 — R3：`core/plugin` barrel 新增 `TOKENS` /
  `ServiceToken` / `Resolver` re-export；新增
  `test/unit/core/plugin/barrel-exports.test.ts` 與
  `test/unit/eslint/plugin-ioc-import-rule.test.ts` 為這條契約上鎖
  (tech-debt R3)
- 2026-05-24 — R2：`PluginInitContext.registerInstance` facade +
  `PluginLifecycleRunner` phase guard；新增
  `test/unit/core/plugin/lifecycle-guard.test.ts`（8 案例覆蓋 happy /
  duplicate / 4 種 phase 違規 / critical init 重設 / 型別測試）
  (tech-debt R2)
- 2026-05-21 — D1 介面 + D6 落地：新增 guild-onboarding port、`host/lifecycle.ts`
  `PluginLifecycleRunner`（窄介面 `LifecycleHost`）、`cascadeDisable` 純函式化。
- 2026-05-21 — 建立元件 wiki 頁（工程基礎建設）。
