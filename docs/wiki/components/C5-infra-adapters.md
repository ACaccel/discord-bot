# C5 — Infra Adapters

> 路徑：`src/infra/` ｜詳細設計：[`docs/design/C5-infra-adapters.md`](../../design/C5-infra-adapters.md) ｜任務：[`docs/tasks/C5-infra-adapters.md`](../../tasks/C5-infra-adapters.md)

## 職責

把外部 SDK 隔離在 typed adapter 後：mongo（ConnectionManager）、llm（Provider Strategy）、discord 周邊 adapter。

## 現況

待辦：D5（方案 A）— `ConnectionManager` 加 retry / transient-persistent 分類 / `disabledGuilds` / `isDisabled()`。

## 近期變更

- 2026-05-21 — 建立元件 wiki 頁（工程基礎建設）。
