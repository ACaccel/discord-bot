# C5 — Infra Adapters 工程任務

| 欄位     | 內容                                                                 |
| -------- | -------------------------------------------------------------------- |
| 元件     | C5 Infra Adapters                                                    |
| 路徑     | `src/infra/`（`mongo/`、`llm/`、`discord/`）                         |
| 設計檔   | [`docs/design/C5-infra-adapters.md`](../design/C5-infra-adapters.md) |
| 涉及缺口 | D5（`ConnectionManager` retry / 降級分類）                           |

---

## D5 — `ConnectionManager` retry / 降級分類（P1，DECIDED 方案 A）

> 裁定方案 A：retry、transient/persistent 分類、`disabledGuilds` 全部移入
> `ConnectionManager`，對外暴露 `isDisabled(guildId)`；`BaseBot` 退化為查詢端。
> `BaseBot` 端改動見 [C11](C11-bot-composition-roots.md) D5，`requireGuildRepos`
> 改動見 [C6](C6-handlers.md) D5。

- [ ] 新增 `isTransient(error: DatabaseError): boolean` helper，依
      `DATABASE_TIMEOUT` / `DATABASE_NETWORK` sub-code 判定。**落點協調**：
      C4 G-2 會把 mongoose error-translator 從 `infra/mongo/error-translator.ts`
      移至 `src/persistence/error-translator.ts`——`isTransient` 應落於搬遷後的
      `persistence/error-translator.ts`，`ConnectionManager` 由 `persistence/`
      import 之（`infra → persistence` 為合法依賴方向）。兩項任務須協調，
      不得各自重建此檔
- [ ] `ConnectionManager.getConnection` 內部對 transient 失敗做**有上限的退避重試**
- [ ] 重試耗盡或 persistent 失敗時，把該 `guildId` 標記為 disabled
- [ ] `ConnectionManager` 在標記 guild disabled 時**自行生成 `traceId`**
      （原由 `BaseBot` boot 時 per-bot 產生）
- [ ] 新增 `isDisabled(guildId)`，回傳 disabled 狀態與其 `traceId`
- [ ] 在 C5 設計文件明示 **per-URI 共用範圍**：`ConnectionManager` 以 URI 為 key
      共用（`sharedConnectionManagers` map），`disabledGuilds` 成為內部狀態後，
      共用同一 URI 的 bot 會共享此 set
- [ ] 確認 `traceId` 穿線一致——`requireGuildRepos`（C6）取得的 `traceId` 與
      結構化 log 中的一致
- [ ] 補測試：以 `StaticConnectionManager` + 注入失敗，驗證 transient 重試與
      persistent 標記行為

**驗收**：transient 失敗有重試；`disabledGuilds` 與分類邏輯均位於
`ConnectionManager`；`isDisabled(guildId)` 對外可查；REQ-C3 驗收場景
（故意設壞測試 guild 的 Mongo URI → 該 guild handler 回 `errors:db.guild_disabled`
附 `traceId`）通過。

---

## 交叉引用

- `BaseBot` 移除自持 `disabledGuilds`、改為查詢端：[C11 — Bot Composition Roots](C11-bot-composition-roots.md) D5
- `requireGuildRepos` 改讀 `ConnectionManager.isDisabled(...)`：[C6 — Handlers](C6-handlers.md) D5
- mongoose error-translator 搬遷至 `persistence/`（影響 `isTransient` 落點）：[C4 — Persistence](C4-persistence.md) G-2
