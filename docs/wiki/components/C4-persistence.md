# C4 — Persistence

> 路徑：`src/persistence/` ｜詳細設計：[`docs/design/C4-persistence.md`](../../design/C4-persistence.md) ｜任務：[`docs/tasks/C4-persistence.md`](../../tasks/C4-persistence.md)

## 職責

以 Repository pattern 封裝 MongoDB 存取：7 組 `XRepo` 介面 + `MongoXRepo` 實作 + schemas。

## 現況

待辦：G-2（方案 Y）— 七個 repo 邊界改回 `Result<T, DatabaseError>`，mongoose error-translator 移入 `persistence/`。

## 近期變更

- 2026-05-21 — 建立元件 wiki 頁（工程基礎建設）。
