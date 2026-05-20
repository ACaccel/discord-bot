# C1 — Core Infrastructure

> 路徑：`src/core/（除 ioc/、plugin/）` ｜詳細設計：[`docs/design/C1-core-infrastructure.md`](../../design/C1-core-infrastructure.md) ｜任務：[`docs/tasks/C1-core-infrastructure.md`](../../tasks/C1-core-infrastructure.md)

## 職責

分層架構最底層，提供與業務無關、與第三方 SDK 無關的純基礎設施：config / errors / result / i18n / logger / time / ids / guild-registry。

## 現況

設計檔判定無實質偏差。待辦：D4 — 若 `JobManager` 無 Discord/Mongo 相依，評估遷入 `core/`（條件性，待 C8 D4 盤點）。

## 近期變更

- 2026-05-21 — 建立元件 wiki 頁（工程基礎建設）。
