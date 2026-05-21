# C4 — Persistence 工程任務

| 欄位     | 內容                                                                 |
| -------- | -------------------------------------------------------------------- |
| 元件     | C4 Persistence                                                       |
| 路徑     | `src/persistence/`                                                   |
| 設計檔   | [`docs/design/C4-persistence.md`](../design/C4-persistence.md)       |
| 涉及缺口 | G-2（repository 邊界 `Result` 一致性，本任務檔新增；DECIDED 方案 Y） |

---

## 說明

C4 設計檔 §7 判定「無實質偏差」。HLD §5 C4 列出的 7 個 repository
（activity / fetch / giveaway / message / reply / todo / user-api-setting）
與現況完全一致。`docs/design/gaps.md` 的 D1–D9、G-1 均不直接涉及 C4。

設計檔另記錄一項文件與實作不一致——HLD §7.2 稱 repository 邊界以 `Result`
傳遞，實際僅 LLM service 用 `Result`，repository 採擲 `DatabaseError`
（僅 `MongoMessageRepo`）或讓 raw mongoose 錯誤直接 propagate（其餘六個 repo）。
設計檔將其判定為「設計風格差異」。經裁定，仍列為本元件的一致性收斂任務（G-2）。

---

## G-2 — repository 邊界 `Result` 一致性（P2，DECIDED 方案 Y）

> 本項不在 `gaps.md` D1–D9 / G-1 原始 backlog 內，為任務劃分時依使用者裁定
> 新增。**裁定方案 Y**：七個 repository 邊界統一改為回傳
> `Result<T, DatabaseError>`，對齊 HLD §7.2，徹底消滅 proposal P4 在
> repository 層的殘留；並把 mongoose error-translator 移入 `persistence/`，
> 避免七個 repo 全面反向 import `infra/mongo`。

### 設計約束（執行時務必遵守）

- **程式員錯誤不進 `Result`**：非正整數 `limit`、非法 timestamp 區間等契約
  違反，**仍擲 `TypeError`**，不包進 `Result`。改造後的 repo 同時有
  `Result.err`（domain 失敗）與擲 `TypeError`（程式員錯誤）兩個出口——
  此為 C1 兩通道契約，不可混淆。
- **not-found 為 `ok(undefined)`**：`findByX` 查無資料維持回 `undefined`，
  包成 `ok(undefined)`，**不是** `err`。只有 DB 查詢真的失敗才 `err`。
- **重複鍵為成功路徑**：`insertManyIgnoringDuplicates` 對帶 `insertedDocs`
  的 `BulkWriteError` 維持當成功，回 `ok({ inserted, duplicates })`；僅其他
  Mongo 錯誤回 `err`。

### 任務

- [x] 把 mongoose error-translator 從 `src/infra/mongo/error-translator.ts`
      移至 `src/persistence/error-translator.ts`（含 `databaseErrorFrom`、
      私有 `classify`、`__classifyMongoErrorForTests` 測試 export）；更新
      `MongoMessageRepo` 與其餘既有 import 路徑
- [x] 與 [C5](C5-infra-adapters.md) D5 協調：`isTransient` helper 一併落於
      搬遷後的 `persistence/error-translator.ts`，兩項任務不得各自重建此檔
- [x] 七個 `XRepo` 介面方法簽章改為回傳 `Result<T, DatabaseError>`
      （`T` 含 not-found 的 `XDoc | undefined`、布林、`InsertResult` 等原型別）
- [x] 七個 `MongoXRepo` 實作加 `try/catch`，mongoose 錯誤經 `databaseErrorFrom`
      包成 `DatabaseError` 回 `err(...)`，成功回 `ok(...)`
- [x] 確認程式員錯誤路徑（`TypeError`）保留，未被包進 `Result`
- [x] in-memory fake repo 同步改簽章，與新介面一致
- [x] 更新所有 repo callsite（plugin / handler 內委派邏輯）改以 `isOk` /
      `isErr` 解構；以 `yarn typecheck:emit`（涵蓋全 `src/**`）掃出漏改的
      callsite
- [x] 補 / 改各 repo 的單元與 integration test，覆蓋 `Ok` / `Err` 兩路徑
- [x] 修正 HLD §7.2、C4 設計檔 §7 與其偏差段落，使文件與實作一致（偏差消失）
- [x] 在 `docs/design/gaps.md` §3 彙總表與 §4 決議紀錄補登 G-2
- [x] 本缺口獨立成一個 PR，便於 review 與必要時 revert

**驗收**：七個 repository 邊界皆回 `Result<T, DatabaseError>`；程式員錯誤仍走
`TypeError`；error-translator 位於 `persistence/`；HLD §7.2、C4 設計檔與
repository 實作三者一致；`yarn typecheck:emit`、單元與 integration 測試全綠。

---

## 交叉引用

- `Result` 型別定義：[C1 — Core Infrastructure](C1-core-infrastructure.md)（`core/result/`）
- `databaseErrorFrom` 錯誤轉譯：[C5 — Infra Adapters](C5-infra-adapters.md)
- 方案 Y 涉及的 repo 消費端：[C6 — Handlers](C6-handlers.md)、[C8 — Plugins](C8-plugins.md)
