# Codebase 審閱報告（2026-05-21）

審閱範圍：`src/` 全樹（約 16,800 行 TypeScript，190 個檔案）、`docs/`、建置與測試設定。
審閱方式：架構審閱（`architecture-reviewer` 稽核）、分層 / 模組化檢查、i18n 結構分析、註解風格檢查。

---

## 1. 整體品質結論

整體屬於**良好的商業級分層架構**，重構（Phase 0–7 + gap-remediation）確實落地：

優點

- 分層依賴方向真正被遵守。`src/core/**` 無任何 `discord.js` / `mongoose` 的值匯入，也無下游層的值匯入；`infra` / `persistence` 不反向匯入 `handlers` / `plugins` / `bot`。無反向邊、無跨層捷徑。
- 無 stringly-typed 的 model 查找，資料存取一律走具型別的 Repository。
- IoC 容器（`src/core/ioc/container.ts`，約 280 行）乾淨且有充分註解：具型別的 `ServiceToken<T>`、`Resolver` 與 `ServiceContainer` 分離。沒有 `reflect-metadata`、沒有 DI 框架——以本專案規模而言比例恰當，**不算過度設計**。
- Plugin runtime hook 一律透過 `ctx.resolve(TOKENS.X)`，hook 內無 Service Locator。
- 採用的設計模式（Microkernel/Plugin host、Repository、LLM Strategy、Result/Either、InteractionRouter 的 Chain-of-Responsibility）皆有 rationale 註解，對維護者來說**不會太艱澀**。

結論：分層與模式紀律扎實，可讀性整體良好。主要技術債集中在 `BaseBot` 一個類別，加上全樹註解仍停留在「重構過程」語氣（見第 4 節）。

---

## 2. 模組化問題（依優先序）

### 高 — `BaseBot` 是 God-class 風險點

`src/bot/index.ts` 約 1,018 行、約 25 個 public 成員，同時負責：生命週期編排、IoC 接線、guild 註冊、per-guild DB 連線、reboot 訊息、8 個原生 `client.on` listener、reaction 抓取與分派、InteractionRouter 組裝。

其 docstring 自稱「Thin lifecycle owner」，但與現況不符。建議抽出：

- `GuildRegistrar`（`registerGuild()`，約 :760-800）
- `ClientEventBridge`（`listen()` 的 `client.on` 扇出，約 :679-729）
- `GuildDbConnector`（`connectGuildDB` / `connectOneGuild`）

這是本報告對維護性最重要的單一建議。

### 中 — DI 之外的隱藏全域旁路

`src/plugins/voice/internal/active-controller.ts` 與 `src/infra/llm/models-catalog.ts` 使用 module-scope 的可變 holder（`let active`）把 `VoiceController` 從 plugin 的 `init` hook 傳給 `BaseBot.run()`（`src/bot/index.ts:523`）。這是繞過 DI 的隱藏旁路——新進工程師追 `bot.voice` 不會在容器裡找到接線。建議改由 plugin 在容器註冊 `TOKENS.VoiceController`。

### 中 — `plugins/**` 直接值匯入 `core/ioc`

8 個 `plugin.ts` 都 `import { TOKENS } from '../../core/ioc'`。分層契約限定 `core/ioc` 僅供 `src/bot/**` 與 `test/**`，但 `eslint.config.mjs` 的 `no-restricted-imports` 未列入 `plugins/**`——lint 通過卻與契約矛盾。建議擇一：(a) 由允許的模組 re-export `TOKENS`；(b) 在契約與 eslint 註解中明文承認 plugin 為合法 `TOKENS` 消費者。

### 中 — 部分 handler 過長

`src/handlers/commands/db_list_message/index.ts` 322 行，把日期解析、時間運算、reaction 文字渲染、附件組裝與 command class 全塞一檔。`inspect_member_ids`(172)、`emoji_frequency`(161)、`ai_settings`(158) 也偏長。建議把純函式 helper 抽到同目錄的獨立模組。

### 低

- `src/bot/index.ts:902` `traceId` 用 `Math.random().toString(36)`，非密碼學、高負載下易碰撞；建議 `crypto.randomUUID()`。
- `login()`（約 :619-634）登入失敗後僅記 log 即落下，仍對呼叫端「成功」回傳；失敗應 reject 讓 `run()` 中止。
- `src/` 仍有約 25 處 `console.*`，與結構化 logger 標準不一致。
- `BaseBot` 命名不一致：`commandHandlers`（複數）對 `buttonHandler` / `modalHandler`（單數）同為 `Map`；`help_msg` / `guild_num` / `debug_ch` 等 snake_case 區域變數混在 camelCase 中。
- `src/bot/index.ts` 在兩段 import 之間夾了可執行碼（`sharedConnectionManagers`，約 :31-38）；應將所有 import 置頂。

---

## 3. i18n 是否需要獨立拆成一個 module？

**結論：不需要新增獨立 module。已將原 `src/interface/` 改名為 `src/i18n/` 以反映其唯一職責。**

現況：

- `src/core/i18n/`：i18n **機制**（i18next 包裝、`catalog-loader`、`locale-resolver`、`bind`）——屬純基礎設施。
- `src/i18n/locales/`：i18n **內容**（`commands/errors/replies` 的 JSON 字典）——屬內容資料層，與 core 分離。

「機制在 core、內容在獨立資料層」是合理的分層決定，不應為了「拆 module」而把字典搬進 core——那會讓 core 夾帶介面文字內容。

殘餘的分層耦合：`src/core/i18n/catalog-loader.ts` 的 `DEFAULT_LOCALES_DIR` 仍硬編碼 `path.resolve(__dirname, '..', '..', 'i18n', 'locales')`，等於 core 仍知道內容層目錄。修正方式：

1. 移除 `DEFAULT_LOCALES_DIR` 預設值，改由 composition root（`bot/*/index.ts`）顯式注入 `localesDir`。
2. 或保留預設並在文件明示這是「唯一允許的 core→content 例外」。

是否「拆成獨立 package」的更高層判斷：目前只有 2 個 locale、3 個 namespace、約 1,568 行字典，`core/i18n` 6 個檔共 348 行。規模不足以支撐獨立 package；現行 core 子模組的粒度恰當，**拆分屬過早最佳化**。

---

## 4. 註解風格：仍是「重構過程」語氣，需改為 release 風格

掃描結果：**64 個 `.ts` 檔**的註解仍引用重構過程，而非直接說明現況。常見字樣：`Phase 0/4b/6`、`gap D1-D9`、`audit PR-x`、`preserved verbatim`、`legacy`、`flagged by audit`、`replaces the previous`、`migrates`、`transitional`。

問題：release 版本的讀者不需要知道「這段碼是從哪個舊檔搬來、第幾階段做的」。這類註解會隨時間失真，且把實作史當成行為說明。

典型例子（移除前）：

- `src/core/i18n/translator.ts`:「Phase 0 only ships the contract... Phase 6 wires this through...」——應直接說 Translator 的契約與用法。
- `src/core/i18n/catalog-loader.ts` `TranslationKey`:「Today this is `string`; Phase 6 will narrow it...」——應只描述目前型別。
- `src/bot/nijika/nijika.ts`:「Phase 4b plugin registration. Audit B-2 removed... PR-G4 dropped...」——應只說明註冊了哪些 plugin。
- 各 plugin header 的「Behaviour preserved verbatim from `src/events/...`」「ported... during gap-remediation (gap D4)」。

處理方式（已完成）：對全部受影響檔案做一次註解 release 化——保留「為什麼」（trade-off、不明顯決策、模式 rationale），刪除「重構史」框架。

已執行的變更涵蓋 `src/core`、`src/bot`、`src/handlers`、`src/infra`、`src/persistence`、`src/plugins`
共約 70 個檔案，移除的字樣包括 `Phase 0/4b/6/7`、`gap D1-D9`、`audit PR-x` / `audit B-2` /
`audit C-8 split`、`preserved verbatim`、`ported`、`flagged by audit`、`replaces the previous`、
`transitional`、以及對已退役 `src/events/` / `src/utils/` / `src/db/` 的「曾經位於」敘述。
所有變更僅動註解，未改任何程式碼、識別字或字串字面值；`// i18n-ignore:` 指令與
`registry.generated.ts` 未受影響。

驗證：`yarn typecheck`、`yarn lint`（0 errors）、`yarn test`（431 測試全綠）、`yarn format:check` 皆通過。

---

## 5. TTS 功能已移除（已完成）

原因：`src/plugins/tts-reply/tts-api.ts` 硬編碼了本機路徑與本機服務位址，會在原始碼中暴露部署環境：

- `TTS_ENDPOINT = 'http://localhost:7860/run/predict/'`
- `TTS_TEMP_PATH = '/home/acaccel/.wine/drive_c/users/acaccel/Temp'`

已執行的變更：

- 刪除 `src/plugins/tts-reply/`（`index.ts` / `plugin.ts` / `tts-api.ts`）。
- 刪除 `test/unit/plugins/tts-reply.test.ts`。
- `src/plugins/index.ts`：移除 `TtsReplyPlugin` 匯出。
- `src/bot/nijika/nijika.ts`：移除 import 與 `this.use(TtsReplyPlugin)`。
- `src/i18n/locales/{en,zh-TW}/replies.json`：`nijika.help_message` 移除 tts 條目並重新編號。
- `src/bot/index.ts`：更新引用 `TtsReplyPlugin` 的 docstring。

驗證：`yarn typecheck` 通過；`yarn test` 全綠（63 檔 / 431 測試）。

註：`src/plugins/voice/`（語音「錄音」plugin）是獨立功能，未受影響、予以保留。

---

## 6. 建議優先序

本次已完成：TTS 移除（第 5 節）、註解 release 化（第 4 節）。其餘建議：

| 優先 | 項目                                                                                    |
| ---- | --------------------------------------------------------------------------------------- |
| 高   | 拆解 `BaseBot`（抽出 `GuildRegistrar` / `ClientEventBridge` / `GuildDbConnector`）      |
| 中   | 消除 `voice` / `models-catalog` 的 module-global holder，改走 IoC token                 |
| 中   | 對齊 `plugins/** → core/ioc` 的契約與 eslint 規則                                       |
| 中   | 拆分過長 handler（`db_list_message` 等）                                                |
| 中   | 修正 `catalog-loader.ts` 對 `interface/locales` 的硬編碼路徑（第 3 節）                 |
| 低   | `traceId` 改 `crypto.randomUUID()`、`login()` 失敗 reject、清除 `console.*`、命名一致化 |
