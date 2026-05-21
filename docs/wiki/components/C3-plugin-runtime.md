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

## 近期變更

- 2026-05-21 — D1 介面 + D6 落地：新增 guild-onboarding port、`host/lifecycle.ts`
  `PluginLifecycleRunner`（窄介面 `LifecycleHost`）、`cascadeDisable` 純函式化。
- 2026-05-21 — 建立元件 wiki 頁（工程基礎建設）。
