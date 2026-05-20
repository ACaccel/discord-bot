# C2 — IoC Container

> 路徑：`src/core/ioc/` ｜詳細設計：[`docs/design/C2-ioc-container.md`](../../design/C2-ioc-container.md) ｜任務：[`docs/tasks/C2-ioc-container.md`](../../tasks/C2-ioc-container.md)

## 職責

約 280 行手寫 IoC 容器，以 `ServiceToken<T>` 型別化管理依賴生命週期，取代 Service Locator。

## 現況

設計檔判定無偏差。無缺口收斂任務。

## 近期變更

- 2026-05-21 — 建立元件 wiki 頁（工程基礎建設）。
