# C5 — Infra Adapters

> 路徑：`src/infra/` ｜詳細設計：[`docs/design/C5-infra-adapters.md`](../../design/C5-infra-adapters.md) ｜任務：[`docs/tasks/C5-infra-adapters.md`](../../tasks/C5-infra-adapters.md)

## 職責

把外部 SDK 隔離在 typed adapter 後：mongo（ConnectionManager）、llm（Provider Strategy）、discord 周邊 adapter。

## 現況

D5（方案 A）已完成 — `ConnectionManager`（`MongoConnectionManager` / `StaticConnectionManager`）已內建 retry / transient-persistent 分類 / `disabled` set / `isDisabled()`：

- 失敗分類：`persistence/error-translator.ts` 的 `isTransient(error: DatabaseError)`（`DATABASE_TIMEOUT` / `DATABASE_NETWORK` 為 transient，其餘 persistent）。
- `getConnection` 對 transient 失敗做有上限的指數退避重試（`RetryPolicy`：預設 3 次嘗試 / 200ms 起 / 2s 上限，建構子可注入）；重試耗盡或 persistent 失敗則把 `guildId` 標記 disabled、自行生成 `traceId`、寫一行 operator stderr。
- `isDisabled(guildId): DisabledGuildState | undefined` 對外可查（`traceId` + 分類後的 `DatabaseError`）；disabled 後 `getConnection` 短路丟同一錯誤；`close` / `closeAll` 清除 marker。
- `BaseBot` 退化為查詢端：不再自持 `disabledGuilds` map，`disabledGuilds` 改為投影 `ConnectionManager.isDisabled` 的唯讀 getter。
- per-URI 共用：共用同一 base URI 的 bot 共用同一 `disabled` set（指向同一實體資料庫，失敗即同一失敗）。

交叉引用：`requireGuildRepos`（C6 D5）與 `BaseBot` 完整退化（C11 D5）會進一步收斂讀取來源。

## 現況補充（R2 後）

- `infra/llm/models-catalog.ts` 移除 `setActiveModelCatalog` /
  `getModelCatalog` / `listProviderModels` module-global，`infra/llm`
  barrel 同步移除對應 re-export。`ModelCatalog` 類別保留為純資料持
  有者（cache + API key map），由 `LlmChatPlugin.init` 透過
  `ctx.registerInstance(TOKENS.ModelCatalog, ...)` 註冊；handler 經
  `bot.modelCatalog?.list(provider)` 取用。

## 近期變更

- 2026-05-24 — R2：`models-catalog.ts` 移除 `let activeModelCatalog`
  與 `setActive*` / `getModel*` / `listProviderModels` 全部
  module-global；`infra/llm` barrel 同步收斂。新增
  `test/unit/infra/llm/models-catalog.test.ts` 驗證 DI 接線
  (tech-debt R2)
- 2026-05-21 — D5 收斂：`ConnectionManager` retry / 降級分類 / `isDisabled()`；`isTransient` helper 落於 `persistence/error-translator.ts`；`BaseBot.disabledGuilds` 改為唯讀查詢 getter。
- 2026-05-21 — 建立元件 wiki 頁（工程基礎建設）。
