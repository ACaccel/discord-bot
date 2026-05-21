# C4 — Persistence

> 路徑：`src/persistence/` ｜詳細設計：[`docs/design/C4-persistence.md`](../../design/C4-persistence.md) ｜任務：[`docs/tasks/C4-persistence.md`](../../tasks/C4-persistence.md)

## 職責

以 Repository pattern 封裝 MongoDB 存取：7 組 `XRepo` 介面 + `MongoXRepo` 實作 + schemas。

## 現況

- 7 組 repository（activity / fetch / giveaway / message / reply / todo / user-api-setting），每組為 `interface XRepo` + `class MongoXRepo implements XRepo`；`buildRepos(conn)` 工廠組裝整包 `Repos`。
- **錯誤邊界（G-2 已收斂）**：七個 repository 邊界皆回 `Result<T, DatabaseError>`。mongoose 錯誤經 `databaseErrorFrom` 轉譯為 `DatabaseError` 後以 `err(...)` 回傳；查無資料為 `ok(undefined)`；`insertManyIgnoringDuplicates` 對重複鍵 `BulkWriteError` 維持 `ok`。程式員錯誤（非正整數 `limit`、非法 timestamp 區間）仍擲原生 `TypeError`，不進 `Result`。
- mongoose error-translator 位於 `src/persistence/error-translator.ts`（G-2 自 `infra/mongo/` 搬遷），含 `databaseErrorFrom`、私有 `classify`、`__classifyMongoErrorForTests`；該檔不 import mongoose。
- 對外介面：各 `XRepo` 介面、`MongoXRepo` 實作、`Repos`、`buildRepos`、`databaseErrorFrom`（由 `persistence/index.ts` re-export）。

## 近期變更

- 2026-05-21 — G-2（方案 Y）收斂：七個 repository 邊界統一改回 `Result<T, DatabaseError>`；mongoose error-translator 自 `infra/mongo/` 搬至 `persistence/error-translator.ts`；所有 repo callsite（handler / plugin）改以 `result.ok` 判斷，行為等價；HLD §7.2、C4 設計檔 §7 與實作對齊。(gap G-2)
- 2026-05-21 — 建立元件 wiki 頁（工程基礎建設）。
