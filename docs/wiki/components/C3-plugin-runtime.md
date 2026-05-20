# C3 — Plugin Runtime

> 路徑：`src/core/plugin/（含 host/）` ｜詳細設計：[`docs/design/C3-plugin-runtime.md`](../../design/C3-plugin-runtime.md) ｜任務：[`docs/tasks/C3-plugin-runtime.md`](../../tasks/C3-plugin-runtime.md)

## 職責

Plugin 架構微核心：定義 `Plugin<Config>` 契約並驅動生命週期、事件分派、InteractionRouter 路由。

## 現況

待辦：D1 — 定義 guild-onboarding port 介面；D6 — 抽出 `host/lifecycle.ts` 的 `PluginLifecycleRunner`（窄介面）。

## 近期變更

- 2026-05-21 — 建立元件 wiki 頁（工程基礎建設）。
