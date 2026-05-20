# 詳細設計與實作差異 — 待修正清單

| 欄位     | 內容                                                                     |
| -------- | ------------------------------------------------------------------------ |
| 文件類型 | 缺口追蹤清單（Gap / Remediation Backlog）                                |
| 文件版本 | 1.0                                                                      |
| 最後更新 | 2026-05-20                                                               |
| 來源     | [`docs/design.md`](../design.md) §5 偏差彙總，逐元件 §7「與 HLD 的偏差」 |
| 用途     | 追蹤 proposal / HLD 目標設計與現況 codebase 的落差，作為收斂工作依據     |

---

## 1. 說明

本清單記錄詳細設計（[`docs/design/`](.)）撰寫過程中、比對實際 codebase 所發現的**目標設計未落地處**。每個項目對應 `docs/design.md` §5 的偏差編號（D1–D9），加上設計審查另發現的程式碼一致性問題（G-\*）。

**狀態定義**：

- `OPEN` — 尚未處理（修正方向已明確，無待決議點）
- `DECIDED` — 修正方案已裁定（見該項「裁定方案」與 §4 決議紀錄），尚未開工
- `IN PROGRESS` — 收斂中
- `DEFERRED` — 經決議延後（須註明決議來源）
- `DONE` — 已收斂並驗證

**優先級定義**：

- `P1` — 阻擋 proposal §6「所有需求已落地」之宣稱，或影響行為正確性
- `P2` — 文件與實作不一致，造成讀者誤判，但不影響執行
- `P3` — 程式碼一致性 / 整潔度問題

---

## 2. 待修正項目

### D1 — guild-onboarding port 不存在

| 欄位     | 內容                                          |
| -------- | --------------------------------------------- |
| 優先級   | P1                                            |
| 狀態     | OPEN                                          |
| 涉及元件 | C3 Plugin Runtime、C8 Plugins、C11 Bot 組裝根 |
| 對應需求 | REQ-A3、HLD §5 C3 / §9.4                      |

**現況**：全 `src/` 無 guild-onboarding port（無 `onboard` 字樣）。`guildCreate` 仍由 legacy `src/events/guild_event.ts` 的 `detectGuildCreate(guild, bot)` 處理，穿透 `BaseBot.connectOneGuild` 與 `commandHandlers` 內部結構。

**目標**：C3 新增 typed guild-onboarding port 介面；C11 `BaseBot` 提供實作；`guild-events` plugin 經此 port 訂閱 `guildCreate` 完成新 guild 初始化。

**修正步驟**：

1. 在 `src/core/plugin/types.ts`（或新檔）定義 guild-onboarding port 介面，封裝「連線新 guild 的 DB」「註冊該 guild 的 command」兩項能力。
2. `BaseBot` 將 `connectOneGuild` 與 command 註冊邏輯收斂為 port 實作，註冊為 `TOKENS` 之一。
3. `guild-events` plugin 新增 `events.guildCreate` 訂閱，經 `ctx.resolve` 取 port 完成初始化。
4. 刪除 `src/events/guild_event.ts`。
5. 補拓撲 / 生命週期測試與 `guildCreate` 的 integration test。

**驗收**：`guildCreate` 路徑不再穿透 `BaseBot` 內部結構；`src/events/guild_event.ts` 不存在。

---

### D2 — `earthquake` plugin 不存在

| 欄位     | 內容                       |
| -------- | -------------------------- |
| 優先級   | P1                         |
| 狀態     | OPEN                       |
| 涉及元件 | C8 Plugins、C11 Bot 組裝根 |
| 對應需求 | HLD §5 C8 / §9.4           |

**現況**：無 `src/plugins/earthquake/`。地震速報是 `src/events/earthquake.ts` 的 free function `earthquake_warning(...)`，由 `src/bot/nijika/index.ts` inline `app.listen()` + `r.post('/discord/earthquake', ...)` 接上。

**目標**：bot-scoped `earthquake` plugin（僅 `nijika` 組裝），於 `start` hook 內擁有 Express 路由與廣播邏輯。

**修正步驟**：

1. 新建 `src/plugins/earthquake/`，工廠 `createEarthquakePlugin(config)`，`scope='bot'`。
2. `start` hook 內建立 Express 路由 `/discord/earthquake`，收速報後對各 guild 地震 channel 廣播。
3. 把 `earthquake_warning` 邏輯遷入 plugin `internal/`。
4. `nijika` 改以 `this.use(createEarthquakePlugin(...))` 組裝；移除 `index.ts` 的 inline 路由。
5. 刪除 `src/events/earthquake.ts`。
6. 補 plugin 生命週期與路由 integration test。

**驗收**：`src/plugins/earthquake/` 存在；`nijika/index.ts` 無 inline 地震路由；`src/events/earthquake.ts` 不存在。

---

### D3 — `src/events/` 過渡層仍存在

| 欄位     | 內容                    |
| -------- | ----------------------- |
| 優先級   | P1                      |
| 狀態     | OPEN（由 D1 + D2 收斂） |
| 涉及元件 | C8 Plugins              |
| 對應需求 | HLD §2.2 原則 5、§9.4   |

**現況**：`src/events/` 仍有 `earthquake.ts`、`guild_event.ts`、`index.ts`。HLD 宣稱目標設計「無過渡層、`src/events/` 已消除」。

**目標**：`src/events/` 目錄與 `@event` path alias 一併移除。

**修正步驟**：

1. 完成 D1（吸收 `guild_event.ts`）與 D2（吸收 `earthquake.ts`）。
2. 刪除 `src/events/index.ts` 與整個 `src/events/` 目錄。
3. 移除 `tsconfig.json` 的 `@event` path alias。
4. 更新 CJK scanner 的 `SCOPED_DIRECTORIES`，移除 `src/events`（見 D8 附註）。
5. 全 repo grep `@event` 確認為 0。

**驗收**：`src/events/` 不存在；`grep "@event"` 為 0。

---

### D4 — `src/utils/` 仍存在且被依賴

| 欄位     | 內容                       |
| -------- | -------------------------- |
| 優先級   | P2                         |
| 狀態     | OPEN                       |
| 涉及元件 | C8 Plugins、C11 Bot 組裝根 |
| 對應需求 | REQ-G2、CLAUDE.md 目錄說明 |

**現況**：`src/utils/` 仍有 `bot_cmd.ts`、`job_manager.ts`、`misc.ts`、`index.ts`。giveaway/activity 的 `internal/` 仍 import `JobManager`（`../../../utils/job_manager`）與 `misc`。CLAUDE.md 稱「`utils/` 僅 `logger.ts` strict」已過時（`utils/logger.ts` 已不存在）。

**目標**：`src/utils/` 收斂——`job_manager.ts` 應移入適當層（或 `core/`），`bot_cmd.ts` / `misc.ts` 內容歸入對應元件；過渡 grab-bag 退場。

**修正步驟**：

1. 盤點 `bot_cmd.ts`、`job_manager.ts`、`misc.ts` 的所有 callsite。
2. `JobManager` 為 node-schedule 包裝，評估移入 `src/core/`（無 Discord/Mongo 相依時）或 plugin `internal/`。
3. `bot_cmd.ts`（含 `buildCommandJsonBody`）評估移入 C6 handlers 或 C9 scripts。
4. `misc.ts` 逐函式歸入消費端元件。
5. 刪除 `src/utils/` 與 `@utils` alias，更新 CLAUDE.md 目錄說明。

**驗收**：`src/utils/` 不存在；CLAUDE.md 目錄說明與現況一致。

---

### D5 — `ConnectionManager` 無 retry / 降級分類

| 欄位     | 內容                                               |
| -------- | -------------------------------------------------- |
| 優先級   | P1                                                 |
| 狀態     | DECIDED — 採方案 A（全部移入 `ConnectionManager`） |
| 涉及元件 | C5 Infra Adapters、C11 Bot 組裝根                  |
| 對應需求 | REQ-C3、HLD §5 C5 / §7.4                           |

**現況**：`connection-manager.ts` 無 retry、無 transient-vs-persistent 分類、無 `disabledGuilds` map。disabled-guild 追蹤實際在 `BaseBot.connectGuildDB`（boot 時 catch 失敗、記入 `BaseBot.disabledGuilds` + `traceId`，無重試）。失敗分類只存在於 `error-translator.ts` 的 sub-code。

**目標**：`ConnectionManager` 區分 transient（可重試）與 persistent 失敗、自行重試 transient 失敗、自行維護 `disabledGuilds`；`BaseBot` 退化為查詢端。依 HLD §5 C5 / §7.4 修正實作（不修 HLD 文字）。

**裁定方案（A）**：retry、transient/persistent 分類、`disabledGuilds` 全部移入 `ConnectionManager`，對外暴露 `isDisabled(guildId)`。

**修正步驟**：

1. 在 `error-translator.ts` 新增 `isTransient(error: DatabaseError): boolean` helper（依 `DATABASE_TIMEOUT` / `DATABASE_NETWORK` sub-code 判定），供連線路徑複用。
2. `ConnectionManager.getConnection` 內部對 transient 失敗做有上限的退避重試；重試耗盡或 persistent 失敗則把該 `guildId` 標記為 disabled。
3. `ConnectionManager` 在標記 guild disabled 時**自行生成 `traceId`**（原本由 `BaseBot` boot 時 per-bot 產生）；`isDisabled(guildId)` 回傳 disabled 狀態與其 `traceId`。
4. `BaseBot.connectGuildDB` 移除自有的 `disabledGuilds` 與 catch-記錄邏輯，改查 `ConnectionManager.isDisabled(...)`；`requireGuildRepos`（C6）改讀此來源。
5. 補測試：故意設壞測試 guild 的 Mongo URI，啟動後該 guild handler 回 `errors:db.guild_disabled` 附 `traceId`（REQ-C3 驗收）；以 `StaticConnectionManager` + 注入失敗驗證 transient 重試與 persistent 標記。

**實作注意事項**：

- **per-URI 共用**：`ConnectionManager` 以 URI 為 key 共用（`sharedConnectionManagers` map）。`disabledGuilds` 成為其內部狀態後，共用同一 URI 的 bot 會共享此 set——同一 DB 語意上正確，但須於 C5 設計文件明示此共用範圍。
- **`traceId` 穿線**：`traceId` 由 per-bot 生成下放為 `ConnectionManager` 內部生成，須確保 `requireGuildRepos` 取得的 `traceId` 與結構化 log 中的一致。

**驗收**：REQ-C3 驗收場景通過；transient 失敗有重試；`disabledGuilds` 與分類邏輯均位於 `ConnectionManager`；`BaseBot` 不再自持 `disabledGuilds`。

---

### D6 — `host/` 無 `lifecycle.ts`

| 欄位     | 內容                                                    |
| -------- | ------------------------------------------------------- |
| 優先級   | P2                                                      |
| 狀態     | DECIDED — 採方案 A（抽出 `host/lifecycle.ts` + 窄介面） |
| 涉及元件 | C3 Plugin Runtime                                       |
| 對應需求 | REQ-G1、HLD §5 C3                                       |

**現況**：HLD 寫 `host/{lifecycle,topology,contributes-merger}.ts`，實際 `host/` 僅 `errors.ts`、`topology.ts`、`contributes-merger.ts`。lifecycle 邏輯內聯於 `host.ts` 的私有 `runLifecycle` 方法。

**目標**：把 lifecycle 抽至 `host/lifecycle.ts`，使「新增／刪除／修改生命週期」集中於單一檔案、可獨立單元測試，且模組化由型別強制。

**裁定方案（A + 窄介面）**：採方案 A 抽出 `host/lifecycle.ts`，但**不把整個 `PluginHost` 物件丟進去**——以一個窄介面收斂耦合，避免抽出後變成「host 第二部分」的人為抽象。

**修正步驟**：

1. 定義窄介面 `LifecycleHost`（或 `LifecycleContext`），僅暴露 lifecycle 真正需要的 host 狀態切片：registered plugins map、`order` 陣列、`disabled` map（可讀寫）、dependents 索引、resolver、`EventDispatcher`、`logger` / `translator` / `clock`。
2. 在 `host/lifecycle.ts` 實作 `PluginLifecycleRunner` 類別，建構時注入 `LifecycleHost`，對外提供 `runInit()` / `runStart()` / `runReady()` / `runShutdown()`。
3. 把 `cascadeDisable` 抽成純函式，置於 `host/topology.ts`（作為既有 `buildDependentsIndex` 的天然搭檔），由 `PluginLifecycleRunner` 呼叫。
4. `host.ts` 的 `initAll` / `startAll` / `readyAll` / `shutdownAll` 改為對 `PluginLifecycleRunner` 的薄委派；`host.ts` 回歸「wiring + 公開 API 介面」單一職責。
5. 補測試：以 fake `LifecycleHost` 建構 `PluginLifecycleRunner`，單元測試各 phase、cascade-disable、critical-escalation；既有 host 測試維持綠。

**設計理由**：窄介面從型別上禁止 `lifecycle.ts` 伸手進任意 host 內部——模組化由編譯器強制而非靠紀律；未來新增生命週期 phase / hook 只需改 `lifecycle.ts` 一檔（加 C3 `Plugin` 契約）。

**驗收**：`host/lifecycle.ts` 存在且 `PluginLifecycleRunner` 經窄介面注入；`host.ts` 行數顯著下降；`cascadeDisable` 為純函式且有單元測試；既有測試全綠。

---

### D7 — i18n catalog 僅 `zh-TW`，`commands.json` 為空

| 欄位     | 內容                                       |
| -------- | ------------------------------------------ |
| 優先級   | P2                                         |
| 狀態     | DECIDED — 採方案 A（補完整 `en/` catalog） |
| 涉及元件 | C7 i18n Catalog、C6 Handlers               |
| 對應需求 | REQ-E1、HLD §5 C7 / §7.1                   |

**現況**：磁碟上只有 `zh-TW/`；C1 `translator.ts` 定義 `Locale = 'zh-TW' | 'en'` 但無 `en/`。`commands.json` 為空 `{}`，指令名稱／選項描述仍是 handler 內 CJK literal，以 `// i18n-ignore` 豁免。

**目標**：實際支援 `en` 語系——補完整 `en/` catalog，使 `Locale` union 與磁碟資料一致、`locale-resolver` 的 en 路徑真正可用、catalog-completeness 測試成為有意義的跨語系 gate。

**裁定方案（A）**：補完整 `en/` 語系；不收斂 `Locale` union。

**修正步驟**：

1. 填 `zh-TW/commands.json` 的指令名稱／描述 key（依 README 之 PR 6-3 規劃）。
2. handler 改以 catalog key 取代 CJK literal，移除 `// i18n-ignore` 註記。
3. 新建 `src/interface/locales/en/{commands,errors,replies}.json`，把 `zh-TW` 的全部 key 英譯（含 D9 新增之 `errors:*` 與 `replies:<feature>.failed`）。
4. 確認 catalog-completeness 測試（`yarn test:i18n`）以雙語系比對——任一語系缺 key 即 fail。
5. 確認 `I18NextTranslator` 的 fallbackLocale 對缺漏 key 仍優雅回退至 `zh-TW`。

**維護注意事項**：補 `en/` 後，每新增一個 catalog key 都須同步提供 `zh-TW` 與 `en` 兩份翻譯，否則 catalog-completeness 測試會攔下。此維護負擔須於 C7 設計文件與 `CONTRIBUTING.md` 明示。

**驗收**：`commands.json` 非空；`en/` 三個命名空間檔齊備；`src/handlers/` 無 `// i18n-ignore` 於指令 metadata；catalog-completeness 測試以雙語系運作並通過。

---

### D8 — strict tsconfig 未涵蓋 `src/bot`、`src/handlers`

| 欄位     | 內容               |
| -------- | ------------------ |
| 優先級   | P1                 |
| 狀態     | OPEN               |
| 涉及元件 | C10 Quality Gates  |
| 對應需求 | REQ-F1、HLD §5 C10 |

**現況**：`tsconfig.strict.json` 的 include 僅 `src/core/**`、`src/persistence/**`、`src/infra/mongo/**`、`src/infra/llm/**`、`src/utils/logger.ts`、`scripts/**`、`test/**`。`src/bot/**`、`src/handlers/**`、`src/plugins/**`、`src/infra/discord/**` 不在 strict 範圍（檔內註解標明「PR-G 將擴大」）。

**目標**：strict typecheck 涵蓋全 `src`。

**修正步驟**：

1. 逐步把 `src/infra/discord/**`、`src/plugins/**`、`src/handlers/**`、`src/bot/**` 加入 `tsconfig.strict.json` 的 include。
2. 每納入一個子樹，掃除 `any` escape，改 `unknown` + narrowing；intentional 處加註記。
3. `yarn typecheck` 確認全綠。

**驗收**：`tsconfig.strict.json` include 涵蓋全 `src`；`any` / `as any` 降至個位數。

**附註（CJK scanner 範圍）**：`no-literal-cjk.test.ts` 的 `SCOPED_DIRECTORIES` 含 `src/events`。HLD §7.1 稱 `src/events` 已消除故不在掃描範圍——目前 `src/events/` 仍在（D3），scanner 納入它是正確的；待 D3 完成後同步從 `SCOPED_DIRECTORIES` 移除 `src/events`。

---

### D9 — handler 不直接 catch `DomainError`

| 欄位     | 內容                                                         |
| -------- | ------------------------------------------------------------ |
| 優先級   | P2                                                           |
| 狀態     | DECIDED — 採方案 B（taxonomy-driven + per-feature 語氣回退） |
| 涉及元件 | C6 Handlers、C7 i18n Catalog                                 |
| 對應需求 | REQ-C1、HLD §5 C6                                            |

**現況**：全 `src/handlers/` 零 `instanceof DomainError` / `.messageKey` 用例。handler 採「try/catch 包 `execute()` + 記 log + `editReply` 一個**硬編碼** i18n key」。`DomainError.messageKey` 的 taxonomy-driven 回覆機制只在 plugin 層（`llm-chat/plugin.ts`）被消費。

**目標**：handler catch 後依錯誤型別決定回覆。錯誤同時走兩條獨立通道——operator 通道（結構化 log，永遠記完整錯誤）與 user 通道（`editReply` 一句 i18n 文案）。

**裁定方案（B）**：

- **Operator 通道**：每個 handler catch 內維持 `logError(...)` 寫結構化 log（完整錯誤、`cause`、`context.operation`、`traceId`）。不受下列影響。
- **User 通道**：
  - 錯誤是 `DomainError` → 用 `error.messageKey` + `messageParams`。對應的 `errors.json` 文案**以 bot 人格語氣撰寫**（taxonomy-driven 不等於無語氣——語氣住在 catalog 文案裡）。
  - 錯誤**非** `DomainError`（未預期 / 程式 bug / 未包裝的 infra 錯誤）→ 回退到該指令專屬、有語氣的 `replies:<feature>.failed`，並附 `traceId` 供 operator 對照。

**修正步驟**：

1. 設計 handler 邊界的共用 helper `replyForError(interaction, translator, error, fallbackKey)`：`error instanceof DomainError` → `translator.t(error.messageKey, error.messageParams)`；否則 → `translator.t(fallbackKey, { traceId })`。
2. 各 handler catch 改為「`logError(...)`（operator）+ `replyForError(..., 'replies:<feature>.failed')`（user）」；保留各指令既有的 `replies:<feature>.failed` 語氣文案作為非 `DomainError` 回退。
3. 確認 `errors.json` 內被 `DomainError.messageKey` 引用的文案皆以 bot 語氣撰寫（與 D7 的 `en/` 英譯一併處理）。
4. 補 handler 邊界錯誤對應的單元 / integration test：分別注入 `DomainError` 與 raw error，驗證兩條通道輸出。

**範例**（`add_reply` 指令）：

- 使用者輸入的回覆組已存在 → handler 擲 `ConflictError`（`messageKey: 'errors:conflict.reply_exists'`）→ 使用者看到「這組回覆我已經記起來囉，不用再加一次啦~」。
- 寫入時 Mongo 連線抖動 → `reply` repo 不包錯誤，raw mongoose error propagate → 非 `DomainError` → 使用者看到 `replies:add_reply.failed`「唔...新增失敗了，稍後再試一次看看吧！(代碼 7f3a2c)」，operator log 含完整 stack 與 `traceId` `7f3a2c`。

**驗收**：handler 對 `DomainError` 依 `messageKey` 回覆、對非 `DomainError` 回退 per-feature 語氣文案並附 `traceId`；operator log 兩種情況均含完整錯誤。

---

### G-1 — giveaway / activity 的 `msgReact` 用 `console.error`

| 欄位     | 內容                                |
| -------- | ----------------------------------- |
| 優先級   | P3                                  |
| 狀態     | OPEN                                |
| 涉及元件 | C8 Plugins                          |
| 對應需求 | REQ-C2、CLAUDE.md「無 raw console」 |

**現況**：`src/plugins/giveaway/internal/giveaway.ts` 與 `activity.ts` 的 `msgReact` 使用 raw `console.error` 而非結構化 `Logger`。

**目標**：所有錯誤走結構化 logger。

**修正步驟**：把 `msgReact` 的 `console.error` 改為注入的 `Logger`（經 `deps.logger` 或 `ctx.logger`），記結構化欄位。

**驗收**：`src/plugins/` 無 raw `console.*`；ESLint `no-console` 於 production code 綠。

---

## 3. 彙總表

| #   | 標題                                             | 優先級 | 狀態    | 裁定方案                                   |
| --- | ------------------------------------------------ | ------ | ------- | ------------------------------------------ |
| D1  | guild-onboarding port 不存在                     | P1     | OPEN    | —                                          |
| D2  | `earthquake` plugin 不存在                       | P1     | OPEN    | —                                          |
| D3  | `src/events/` 過渡層仍存在                       | P1     | OPEN    | 由 D1+D2 收斂                              |
| D4  | `src/utils/` 仍存在且被依賴                      | P2     | OPEN    | —                                          |
| D5  | `ConnectionManager` 無 retry / 降級分類          | P1     | DECIDED | A — 全部移入 `ConnectionManager`           |
| D6  | `host/` 無 `lifecycle.ts`                        | P2     | DECIDED | A — 抽 `host/lifecycle.ts` + 窄介面        |
| D7  | i18n 僅 `zh-TW`、`commands.json` 為空            | P2     | DECIDED | A — 補完整 `en/` catalog                   |
| D8  | strict tsconfig 未涵蓋 `src/bot`、`src/handlers` | P1     | OPEN    | —                                          |
| D9  | handler 不直接 catch `DomainError`               | P2     | DECIDED | B — taxonomy-driven + per-feature 語氣回退 |
| G-1 | giveaway/activity `msgReact` 用 `console.error`  | P3     | OPEN    | —                                          |

---

## 4. 決議紀錄

下列四項原為「須由 proposal / HLD 作者裁定」的決議點，已於 2026-05-20 裁定，修正方向見各項 §2 的「裁定方案」與「修正步驟」。

| #   | 決議點                                         | 裁定結果                                                                                                                                                                                               |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D5  | `disabledGuilds` 與 retry / 降級分類的職責歸屬 | **方案 A** — 全部移入 `ConnectionManager`，依 HLD §5 C5 / §7.4 修正實作；`BaseBot` 退化為查詢端。                                                                                                      |
| D6  | `runLifecycle` 是否抽成 `host/lifecycle.ts`    | **方案 A + 窄介面** — 抽出 `host/lifecycle.ts` 的 `PluginLifecycleRunner`，但以窄介面 `LifecycleHost` 收斂耦合，避免「host 第二部分」式抽象。                                                          |
| D7  | 是否實際支援 `en` 語系                         | **方案 A** — 補完整 `en/` catalog，不收斂 `Locale` union；接受每個新 key 須雙語翻譯的維護負擔。                                                                                                        |
| D9  | handler 非 `DomainError` 的錯誤回退策略        | **方案 B** — `DomainError` 走 `messageKey`（語氣寫在 `errors.json` 文案）；非 `DomainError` 回退 per-feature 的 `replies:<feature>.failed` 語氣文案並附 `traceId`；operator 通道永遠記完整結構化 log。 |

**仍 OPEN 的項目**（D1–D4、D8、G-1）修正方向已明確，無待決議點，可依各項 §2 修正步驟開工。其中 D3 依賴 D1 + D2 先完成。
