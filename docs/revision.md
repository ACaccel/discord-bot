# 技術債解決報告（Revision Plan）

對應 [`docs/codebase-review-2026-05.md`](codebase-review-2026-05.md) 第 2 / 3 / 6 節列出的技術債，逐項給出處理計畫、影響範圍、驗收條件、風險與規模估計。已完成項目（TTS 移除、註解 release 化、`src/interface` → `src/i18n` 改名）不再列入。

執行順序按依賴關係：R1 是其他項目的基礎（一旦 `BaseBot` 拆好，DI 旁路與契約對齊都比較好做），其餘項目可平行進行。

---

## R1. 拆解 `BaseBot`（高優先）

### 問題

`src/bot/index.ts` 1,018 行、約 25 個 public 成員，同時擁有：生命週期編排、IoC 接線、guild 註冊、per-guild DB 連線、reboot 訊息、8 個原生 `client.on` listener、reaction 抓取與分派、InteractionRouter 組裝。其 docstring 自稱 thin lifecycle owner，與現況背離。

### 處理計畫

將 `BaseBot` 退回真正的薄殼，抽出三個明確職責的 collaborator：

| 抽出對象            | 來源                                           | 新增位置                         | 職責                                                                       |
| ------------------- | ---------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------- |
| `GuildRegistrar`    | `BaseBot.registerGuild()` 及 reaction 抓取輔助 | `src/bot/guild-registrar.ts`     | 把 `Guild` 物件 + bot 設定組裝成 `GuildInfo`、解析 channels/roles          |
| `ClientEventBridge` | `BaseBot.listen()` 內 8 個 `client.on(...)`    | `src/bot/client-event-bridge.ts` | 把 Discord raw event 轉成已驗證的 domain event 並交給 router / 各 listener |
| `GuildDbConnector`  | `connectGuildDB` / `connectOneGuild`           | `src/bot/guild-db-connector.ts`  | 控制 per-guild Mongo 連線生命週期與失敗分類                                |

`BaseBot` 留下：constructor、`use(plugin)`、`run()` 三段（setupContainer / setupTranslator / startListening）、shutdown 路徑、IoC 容器存取器。

`src/bot/index.ts` 預期降至 ~350 行。

### 影響檔案

- `src/bot/index.ts`（重組）
- 新增 `src/bot/guild-registrar.ts`、`client-event-bridge.ts`、`guild-db-connector.ts`
- `src/bot/{nijika,konata,tomori,msg-archive}/*.ts`（subclass 對 hook 的覆寫位置可能要改名）
- 對應單元測試：每個新類別一支 spec

### 驗收條件

- `src/bot/index.ts` ≤ 400 行、public 成員 ≤ 12
- 三個新類別均有 ≥ 80% 行覆蓋
- 既有 431 個測試全綠
- `architecture-reviewer` Audit 通過、無新增分層違規

### 風險

- 高。`BaseBot` 是所有 bot 的合成根，回歸面積大。
- 緩解：先補上端到端 contract 測試（用 `test/integration/interaction-router/router-dispatch.int.test.ts` 的方式擴大覆蓋），再拆解。

### 規模

中型重構，估 2-3 個工作天，含測試。

---

## R2. 消除 DI 旁路（中優先）

### 問題

`src/plugins/voice/internal/active-controller.ts` 與 `src/infra/llm/models-catalog.ts` 使用 module-scope 的可變 holder（`let active`）把 plugin `init` hook 產出的物件傳給 `BaseBot.run()`（`src/bot/index.ts:523`）。這是繞過 IoC 的隱藏全域旁路。

`active-controller.ts` 註解坦承這個 holder 之所以存在「是因為 plugin 契約沒有暴露 `register` 介面」——真正該補的是契約。

### 處理計畫

1. 在 `Plugin` 契約的 `ctx` 介面增補 `registerInstance<T>(token: ServiceToken<T>, instance: T): void`，只限 `init` hook 內可呼叫，違規時丟 `ConfigurationError`。
2. 新增 `TOKENS.VoiceController` 與 `TOKENS.ModelCatalog`。
3. `VoicePlugin.init` 改為 `ctx.registerInstance(TOKENS.VoiceController, new VoiceController(client))`。
4. `BaseBot.run()` 從 `container.tryResolve(TOKENS.VoiceController)` 拿，並把 `bot.voice` 從 public field 改成 getter。
5. 同樣模式處理 `models-catalog` 的 `setActiveModelCatalog` / `getModelCatalog`。
6. 刪除 `active-controller.ts` 與 `models-catalog.ts` 內的 module-scope holder。

### 影響檔案

- `src/core/plugin/types.ts`（`PluginContext` 介面）
- `src/core/plugin/host.ts`（hook 時機檢查）
- `src/core/ioc/tokens.ts`
- `src/plugins/voice/{plugin.ts,internal/active-controller.ts}`
- `src/infra/llm/{models-catalog.ts,registry.ts,llm-service.ts}` 中所有 `getModelCatalog()` 呼叫點
- `src/bot/index.ts`
- 測試：`test/unit/plugins/voice.test.ts`、`test/unit/infra/llm/models-catalog.test.ts`（新增），既有 plugin host 測試擴增

### 驗收條件

- `grep -rn 'let active' src` 在 plugin / infra 樹回傳空
- DI 走線：`grep -rn 'TOKENS.VoiceController\|TOKENS.ModelCatalog' src` 在 plugin `init` 與 bot `run()` 都看得到
- 全部測試通過

### 風險

- 中。`ctx.registerInstance` 是 plugin 契約的擴張，可能誘導其他 plugin 濫用為通用 register。需在 host lifecycle 內限定僅 `init` 階段可呼叫，並把違規納入單元測試。

### 規模

小至中型，估 1-1.5 個工作天。

---

## R3. 對齊 `plugins/**` 與 `core/ioc` 契約（中優先）

### 問題

8 個 `plugin.ts` 都 `import { TOKENS } from '../../core/ioc'`。分層契約規定 `core/ioc` 僅供 `src/bot/**` 與 `test/**`，但 `eslint.config.mjs` 的 `no-restricted-imports` 未列入 `src/plugins/**`，lint 通過卻與契約矛盾。

### 處理計畫（兩擇一，建議方案 A）

**方案 A**：把 `TOKENS` 與其用得到的型別（`ServiceToken<T>`、`Resolver`）re-export 到 `src/core/plugin/index.ts`。plugin 改 `import { TOKENS } from '../../core/plugin'`，不再直接觸碰 `core/ioc`。

**方案 B**：在 `eslint.config.mjs` 把 `src/plugins/**` 加進允許清單，並在 `core/ioc/index.ts` 註解明文承認 plugin 為合法 consumer。

兩方案二擇一，**A 較佳**：plugin 對「容器接線」零依賴，未來換 DI 框架時 plugin 程式碼不需動。

### 影響檔案

- `src/core/plugin/index.ts`（re-export）
- 8 個 `src/plugins/*/plugin.ts`（改 import 來源）
- `eslint.config.mjs`（可選擇加新規則禁止 plugin 再 import `core/ioc`）
- `.claude/skills/project-conventions/SKILL.md` 與 `CLAUDE.md` 對應段落

### 驗收條件

- `grep -rln "from '.*core/ioc'" src/plugins` 回傳空
- ESLint 規則涵蓋 `src/plugins/**`，違規時 fail

### 風險

- 低。純 import 路徑替換。

### 規模

小，估半天。

---

## R4. 拆分過長 handler（中優先）

### 問題

`src/handlers/commands/db_list_message/index.ts` 322 行，把日期解析、時間運算、reaction 文字渲染、附件組裝與 command class 全塞一檔。`inspect_member_ids`(172)、`emoji_frequency`(161)、`ai_settings`(158) 也偏長。

### 處理計畫

對每個逾 150 行的 handler，把純函式 helper 抽到同目錄獨立模組：

| Handler                       | 抽出                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| `db_list_message/index.ts`    | `parse-range.ts`（日期範圍解析）、`render-reactions.ts`、`build-archive-attachment.ts` |
| `inspect_member_ids/index.ts` | `format-member-list.ts`                                                                |
| `emoji_frequency/index.ts`    | `aggregate-emoji-counts.ts`                                                            |
| `ai_settings/index.ts`        | `validate-ai-settings.ts`                                                              |

`index.ts` 只留 Discord I/O、權限檢查、Translator 呼叫、回覆組裝。

### 影響檔案

上述 4 個 handler 目錄，新增 helper 檔案與其單元測試。

### 驗收條件

- 4 個 handler `index.ts` 均 ≤ 120 行
- 每個抽出的 helper 有對應單元測試（pure function 易測）
- handler registry codegen 不需重跑（檔名未變）

### 風險

- 低。純函式抽取，行為應位元等價。

### 規模

小，每個 handler 約 1-2 小時，共 1 個工作天。

---

## R5. 修正 `catalog-loader.ts` 對內容目錄的硬編碼路徑（中優先）

### 問題

`src/core/i18n/catalog-loader.ts` 的 `DEFAULT_LOCALES_DIR` 仍硬編碼 `path.resolve(__dirname, '..', '..', 'i18n', 'locales')`。core 知道 `src/i18n` 目錄存在，是 core → content 的反向耦合。

### 處理計畫

1. 移除 `DEFAULT_LOCALES_DIR` 預設值，`LoadCatalogOptions.localesDir` 改為必填。
2. `createDefaultTranslator` 改為強制接 `localesDir: string` 參數。
3. composition root（`src/bot/{nijika,konata,tomori,msg-archive}/index.ts`）顯式計算路徑：
   ```ts
   const localesDir = path.resolve(__dirname, '..', '..', 'i18n', 'locales');
   const translator = await createDefaultTranslator({ localesDir });
   ```
   `__dirname` 在 composition root 算內容層位置是合理的——bot 確實知道自己的部署佈局。

### 影響檔案

- `src/core/i18n/catalog-loader.ts`
- 4 個 bot 的 `index.ts` 或對應的 `setupTranslator` 路徑
- 對應測試 fixture（已注入 `localesDir` 的測試不受影響）

### 驗收條件

- `grep -n "'i18n'" src/core` 回傳空
- 既有 catalog completeness 測試通過

### 風險

- 低。介面收窄，呼叫端編譯期報錯即可發現遺漏。

### 規模

極小，估 1-2 小時。

---

## R6. 低優先清理項

下列為單點修正，互不相依，可在任何 sprint 順手做：

### R6.1 `traceId` 隨機性

- 位置：`src/bot/index.ts:902`（router middleware 內）
- 現況：`Math.random().toString(36).slice(2, 10)`
- 修正：`crypto.randomUUID().slice(0, 8)`
- 理由：高負載下 `Math.random()` 重複機率不可忽略，會讓 traceId 失去唯一性。

### R6.2 `login()` 失敗應 reject

- 位置：`src/bot/index.ts:619-634`
- 現況：`client.login(...).catch(err => log)`；失敗只記錄，方法仍 resolve；後續 `run()` 流程繼續執行才靠 `!this.client.user` guard 阻擋。
- 修正：`await client.login(...)` 並把 catch 改成 `throw`，讓 `run()` 在登入失敗時立即中止。
- 理由：登入失敗是不可恢復狀態，繼續走 startAll 只會放大錯誤面。

### R6.3 殘餘 `console.*`

- 位置：`grep -rn 'console\.' src` 仍有 ~25 處
- 修正：改用 `bot.logger.info / warn / error`；對啟動前（logger 尚未就位）的呼叫，使用 `createBootstrapLogger()`。
- 風險：低；逐一替換並執行測試。

### R6.4 `BaseBot` 命名一致化

- `commandHandlers`（複數）vs `buttonHandler / modalHandler / ssmHandler / reactionHandler`（單數）——全部統一為複數。
- `help_msg / guild_num / debug_ch` 等 snake_case 區域變數改 camelCase。
- 公開欄位改名需同步搜尋 handler 端呼叫；建議與 R1 同批改。

### R6.5 `src/bot/index.ts` import 之間夾執行碼

- 位置：`src/bot/index.ts:31-38`，`sharedConnectionManagers` map 在第一段 import 與第二段 import 之間。
- 修正：把所有 import 移到檔首，`sharedConnectionManagers` 與 helper 放到第一段非 import 程式碼處。

### 規模

合計約 1 個工作天。

---

## 驗收與滾動驗證

每個 R 項完成後執行：

```bash
yarn typecheck && yarn lint && yarn test && yarn format:check
```

R1、R2 完成後另跑 `architecture-reviewer` 與 `reliability-reviewer` Audit。

整體完成後 `BaseBot` LOC、`grep` 殘餘清單、測試覆蓋率三項數字應同時改善，作為退場條件。

---

## 不在本計畫範圍

- 既有 design pattern 的替換（Plugin host、Repository、Strategy）——本次評估認為比例恰當，不動。
- 既有 i18n 機制的替換（i18next）——目前無痛點。
- 新功能與規格變更——本計畫只清債、不擴張。
