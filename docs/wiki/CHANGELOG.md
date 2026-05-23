# Wiki 變更日誌

倒序記錄（最新在上）。每次程式碼 / 文件的結構性變更由
[`update-wiki`](../../.claude/skills/update-wiki/SKILL.md) skill 追加一筆。

---

## 2026-05-24 — R4：過長 handler 拆分 + 150 行規範 + ESLint enforce

- **元件**：C6 Handlers、C10 Quality Gates
- **缺口**：tech-debt R4
- **變更**：
  - C10 — `eslint.config.mjs` 新增獨立 `src/handlers/**/*.ts` block，套用
    `max-lines: ['error', { max: 150, skipBlankLines: false, skipComments: false }]`。
    `ignores` 顯式列入 `registry.generated.ts` 與三個框架/共用檔
    （`command.ts` / `discord-helpers.ts` / `reply-for-error.ts`），各筆均
    附 inline comment 說明為 PR follow-up；頂層 `**/*.generated.ts`
    ignore 不變。
  - C6 — 4 個示範 handler 拆出 pure helper 至同目錄 sibling 檔：
    - `db_list_message`(320→135 行) + 7 個 helper
      (`parse-range.ts` / `render-reactions.ts` / `sanitize-mentions.ts` /
      `chunk-output.ts` / `format-message-lines.ts` /
      `build-archive-attachment.ts` / `resolve-display-name.ts`)。
      `parseStartEnd` 加上 calendar range guard（month 1-12 / day 1-31），
      合法輸入行為等價。
    - `inspect_member_ids`(172→89 行) + 3 個 helper
      (`parse-ids.ts` / `format-helpers.ts` / `format-member-fields.ts`)。
    - `emoji_frequency`(158→121 行) + 4 個 helper
      (`clamp-options.ts` / `aggregate-emoji-counts.ts` / `rank-emoji.ts` /
      `format-leaderboard.ts`)。
    - `ai_settings`(161→68 行) + 3 個 helper
      (`provider-choices.ts` / `validate-ai-settings.ts` /
      `build-settings-modal.ts`)。`checkAiSettingsReady` 改回傳
      tagged union 讓 handler 可單分支挑 i18n key。
      每個 helper 一支 unit test 於 `test/unit/handlers/<name>/`(共 17
      helper + 17 unit test 檔)。`index.ts` 僅保留 Discord I/O + 權限 +
      Translator 呼叫 + 回覆組裝。
  - 規範文字 — CLAUDE.md、CONTRIBUTING.md、
    `.claude/skills/project-conventions/SKILL.md`、
    `.claude/skills/coding-standards/SKILL.md` 四份文件以**完全相同**
    的繁體中文 5 點段落（「Handler 行數規範」）寫入規則（md5sum 一致）。
- **影響**：純 internal refactor，無 Discord 指令簽名、無 i18n key、
  無對外行為變更（`parseStartEnd` 對非法 calendar 之收斂屬於 defensive
  validation）。CI lint 對 4 個示範 handler 由 red → green；既有 511 →
  546 個 test 全綠（+35 unit test）。

---

## 2026-05-24 — R3：plugins ↔ core/ioc 契約對齊

- **元件**：C2 IoC Container、C3 Plugin Runtime、C8 Plugins、C10 Quality Gates
- **缺口**：tech-debt R3
- **變更**：
  - C3 — `src/core/plugin/index.ts` 新增 `TOKENS` value re-export
    與 `ServiceToken` / `Resolver` type re-export；`ServiceContainer` /
    `createContainer` / `token()` / 容器錯誤型別**刻意不**re-export，
    保留為 composition root 專屬。
  - C8 — 8 個 `plugin.ts`（`auto-reply` / `activity` / `giveaway` /
    `guild-events` / `llm-chat` / `message-backup` / `voice` /
    `earthquake`）的 `import { TOKENS } from '../../core/ioc'` 改為
    `'../../core/plugin'`；`grep -rln "from '.*core/ioc'" src/plugins`
    歸零。
  - C10 — `eslint.config.mjs` 在既有 service-locator guard 之後追加
    `src/plugins/**` 的 `no-restricted-imports` block，明確
    block 任何 `core/ioc` import 並給 plugin 專屬錯誤訊息
    （`Plugins must import TOKENS / ServiceToken from core/plugin, not core/ioc.`）。
  - 規範文字 — CLAUDE.md、CONTRIBUTING.md、
    `.claude/skills/project-conventions/SKILL.md`、
    `.claude/skills/coding-standards/SKILL.md` 四份文件以**完全相同**
    的繁體中文段落（「Plugin 對 IoC 的依賴契約」）寫入規則，便於日後一處改全處同步。
  - 測試 — 新增 `test/unit/core/plugin/barrel-exports.test.ts`
    （3 案例：TOKENS 出現、ServiceToken / Resolver 型別可賦值、寫入面
    API 不被 re-export）與 `test/unit/eslint/plugin-ioc-import-rule.test.ts`
    （2 案例：ESLint programmatic API 對虛擬 `src/plugins/__fixture__/`
    路徑驗證好 / 壞案例）。
- **影響**：純內部 import 路徑搬移；無對外契約變更、無 runtime 行為差異。
  R2 落地的 `TOKENS.VoiceController` / `TOKENS.ModelCatalog` 透過此
  barrel 一併曝露給 plugin。

---

## 2026-05-24 — R2：消除 DI 旁路（`PluginInitContext.registerInstance`）

- **元件**：C2 IoC Container、C3 Plugin Runtime、C5 Infra Adapters、C8 Plugins、C11 Bot Composition Roots
- **缺口**：tech-debt R2
- **變更**：
  - C3 — `PluginInitContext` 增補 `registerInstance<T>(token, instance)`
    facade，只在 `init` hook 合法（其他 lifecycle context 型別層即不
    暴露此方法）；`PluginLifecycleRunner` 新增 phase 追蹤與
    `assertInitPhase` guard，違規拋 `ConfigurationError` with code
    `LIFECYCLE_PHASE_VIOLATION`、messageKey
    `errors:plugin.lifecycle_phase_violation`。`LifecycleHost` 介面
    新增 `container: ServiceContainer` 唯讀欄位（runner 寫入容器的
    單一通道）。
  - C2 — `src/core/ioc/tokens.ts` 新增 `TOKENS.VoiceController` /
    `TOKENS.ModelCatalog`。
  - C7 — `src/i18n/locales/{en,zh-TW}/errors.json` 新增
    `plugin.lifecycle_phase_violation` key。
  - C5 — `infra/llm/models-catalog.ts` 移除 `let
activeModelCatalog`、`setActiveModelCatalog`、`getModelCatalog`、
    `listProviderModels`；`infra/llm/index.ts` barrel 同步收斂。
    `ModelCatalog` 類別保留為純資料持有者。
  - C8 — `plugins/voice/`：`plugin.ts.init` 改以
    `ctx.registerInstance(TOKENS.VoiceController, ...)`；刪除
    `internal/active-controller.ts` 全模組；`internal/index.ts`
    移除 `setActive*` / `getActive*` re-export。
    `plugins/llm-chat/plugin.ts.init` 改以
    `ctx.registerInstance(TOKENS.ModelCatalog, ...)`。
  - C11 — `BaseBot.voice` 改為 getter
    （`container.tryResolve(TOKENS.VoiceController)`），刪除
    `run()` 內 `this.voice = getActiveVoiceController()` 後置同步；
    新增 symmetric getter `modelCatalog`。`/ai_settings` handler
    改用 `bot.modelCatalog?.list(provider)`。
  - 測試 — 新增 `test/unit/core/plugin/lifecycle-guard.test.ts`
    （8 案例：happy / duplicate / 4 種 phase 違規 / critical init
    重設 / 型別層測試）、
    `test/unit/plugins/voice/voice-plugin.test.ts`（2 案例）、
    `test/unit/infra/llm/models-catalog.test.ts`（2 案例）。
- **影響**：plugin → BaseBot 通訊 100% 走 IoC 容器；
  `grep "let active" src/plugins src/infra` 為 0；
  `grep "setActive*|getActive*" src` 為 0。
  公開 API 對既有 handler 等價（`bot.voice?.x()` 仍可用），新增
  `bot.modelCatalog` getter。

---

## 2026-05-24 — R1：拆解 `BaseBot` 為 thin lifecycle owner

- **元件**：C11 Bot Composition Roots、C6 Handlers（連帶改名）
- **缺口**：tech-debt R1（+ 隨手 R6.4 / R6.5）
- **變更**：
  - C11 — 新增 `src/bot/guild-registrar.ts`、`src/bot/client-event-bridge.ts`、
    `src/bot/guild-db-connector.ts` 三個 R1 collaborator。`BaseBot`
    （`src/bot/index.ts`）重寫為 thin lifecycle owner（1007 → 592 行），
    8 條 raw `client.on(...)`、reaction port、reboot 訊息、guild registration、
    per-guild Mongo fan-out 全數搬入 collaborator。新增 protected hook
    `eventBridgeSuppression(): ClientEventBridgeSuppression`，subclass 以此
    關閉不需要的 raw listener。
  - C11 — `src/bot/konata/konata.ts` / `src/bot/msg-archive/msg-archive.ts`
    由 `override interactionEventListener = () => {}` 等 listener override
    遷移至 `protected override eventBridgeSuppression()` hook。
  - C6 — Handler Map 改為複數命名（`buttonHandlers` / `modalHandlers` /
    `ssmHandlers` / `reactionHandlers`），`help_msg → helpMessage`；
    `src/handlers/{buttons,modals,select-menus,reactions}/index.ts` 與
    `src/handlers/commands/help/index.ts` 同步更新。
  - 測試 — 新增 `test/unit/bot/guild-registrar.test.ts`（7 案例）、
    `test/unit/bot/client-event-bridge.test.ts`（10 案例）、
    `test/unit/bot/guild-db-connector.test.ts`（6 案例）；
    `test/integration/bot/run-orchestration.int.test.ts`（4 案例）與
    `test/integration/bot/event-bridge.int.test.ts`（4 案例）作為 R1 拆解
    前後皆綠的 contract baseline。
- **影響**：BaseBot 對外 public surface 縮小（listener method 不再存在；
  subclass 改用 hook）；handler 端讀 `bot.buttonHandlers` 等複數欄位
  （連帶 R6.4）；container / lifecycle 順序契約完全不變。
- **閘門**：typecheck / lint / test (465 cases) / format:check /
  handlers:gen:check / knip — 全綠。

---

## 2026-05-21 — `DatabaseError` messageKey 格式修正（D9 交界 bug）

- **元件**：C4 Persistence、C6 Handlers、C7 i18n（交界修正，不改 task 勾選）
- **缺口**：D9（揭露於 C6 D9 工作）
- **變更**：
  - C4 — `src/persistence/error-translator.ts` 的 `i18nKeyFor` 五個分支由
    `errors.db.*`（點分隔）改為 `errors:db.*`（冒號分隔），與專案其他
    `DomainError.messageKey`（`errors:conflict.*`、`errors:llm.*`）一致。
    原點分隔格式在 i18next 解析下會落空 catalog，使 D9「handler 對
    `DomainError` 依 `messageKey` 回覆」對 `DatabaseError` 退回防禦性
    per-feature `.failed` 回退;修正後改為 taxonomy-driven `errors:db.*`。
  - C7 — `src/i18n/locales/{zh-TW,en}/errors.json` 的 `db` 物件補上
    `duplicate_key` / `timeout` / `network` / `validation` 四個原本完全
    缺失的文案,以 bot 人格語氣撰寫(雙語)。`databaseErrorFrom` 不帶入
    `messageParams`,故四個新文案皆不含插值佔位符;同步移除 `db.unavailable`
    既有的 `{{traceId}}` 佔位符——該 key 對應 `DATABASE_UNKNOWN`、同樣無
    `messageParams`,留著會讓使用者文案露出原始 `{{traceId}}` 字串。
  - 測試 — `test/unit/persistence/error-translator.test.ts` 驗證五個 sub-code
    的 `messageKey` 皆為 `errors:db.*`;`test/i18n/catalog-runtime.test.ts`
    驗證五個 key 在雙語系皆可解析且無未插值佔位符。
- **行為等價**：`DatabaseError` 回覆由「防禦性回退到 per-feature `.failed`」
  變為「taxonomy-driven `errors:db.*`」,屬 D9 明文目標,非回歸。
- **閘門**：typecheck / lint / format:check / test / test:i18n 全綠。

---

## 2026-05-21 — D4 落地（`src/utils/` 過渡層退場）

- **元件**：C1 Core Infrastructure、C6 Handlers、C8 Plugins、C9 Codegen & Scripts、C11 Bot Composition Roots
- **缺口**：D4
- **變更**：
  - C1 — 新增 `src/core/scheduling/`（`job-manager.ts`、`duration.ts`、barrel
    `index.ts`），承接原 `src/utils/job_manager.ts` 的 `JobManager` 與
    `src/utils/misc.ts` 的 `parseDuration`；兩者僅依賴 `node-schedule`，符合
    `core/` 層約束。新增單元測試，scheduling 子模組行/函式/敘述/分支覆蓋皆 100%。
  - C6 — `buildCommandJsonBody` 移入 `src/handlers/commands/command-builder.ts`
    （經 `@cmd` barrel 再匯出）；`buildButtonRows` / `msgReact` / `scheduleJob` /
    `listInOneImage` / `CanvasContent` / `CanvasOptions` 移入
    `src/handlers/commands/discord-helpers.ts`。`msgReact` 改用注入的結構化
    `Logger`，不再有 raw `console.error`。
  - C8 — giveaway / activity 的 `internal/` 改 import `@core/scheduling`，
    不再 import `utils/*`；knip 死碼（`tts_api` / `listChannels` / `deleteJob` /
    `getRandomInterval`）刪除。
  - C9 — 評估 `bot_cmd.ts` 承接點：因 `buildCommandJsonBody` 由 runtime command
    註冊路徑消費且輸入型別屬 handler 契約，裁定歸 C6，不遷入 `scripts/`。
  - C11 — 刪除 `src/utils/` 目錄；移除 `tsconfig.json` / `tsconfig.strict.json` /
    `knip.json` / `vitest.config.ts` / `vitest.workspace.ts` 的 `@utils` 對映；
    更新 `CLAUDE.md` 目錄說明與 alias 表（移除過時的「`utils/` 僅 `logger.ts`
    strict」敘述與已退場的 `events/` / `@event` 條目）。
- **行為等價**：純結構性搬遷，四個 bot 對外行為不變；`msgReact` 失敗路徑由
  raw `console` 改為結構化 log，屬 operator 通道改善，user 行為不變。
- **閘門**：typecheck / typecheck:emit / lint / format:check / handlers:gen:check /
  knip / test / test:coverage / test:i18n 全綠。

---

## 2026-05-21 — C10 D3 落地（CJK scanner 範圍收斂）

- **元件**：C10 Quality Gates
- **缺口**：D3
- **變更**：
  - 從 CJK scanner（`test/i18n/no-literal-cjk.test.ts`）的
    `SCOPED_DIRECTORIES` 移除已刪除的 `src/events` entry，現掃描
    `src/handlers`、`src/plugins`、`src/bot`；更新檔頭 scope rationale 註解。
  - 從 `eslint.config.mjs` service-locator guard 的 `no-restricted-imports`
    block 移除 stale 的 `src/events/**/*.ts`、`src/features/**/*.ts` glob
    （兩目錄均已不存在），並修正註解中 `src/bots/**` 筆誤為 `src/bot/**`。
- **行為等價**：純設定 / 測試範圍收斂，四個 bot 對外行為不變。
- **閘門**：typecheck / lint / knip / test / test:i18n 全綠。

---

## 2026-05-21 — C8 D1/D3 落地、D4 callsite 盤點（plugins 缺口收斂）

- **元件**：C8 Plugins
- **缺口**：D1、D3、D4
- **變更**：
  - D1 — `guild-events` plugin 新增 `events.guildCreate` 訂閱，經
    `ctx.resolve(TOKENS.GuildOnboardingPort)` 完成新 guild 初始化；新增
    `handleGuildCreate`（失敗只記 log、不重擲）。`BaseBot.listen` 新增
    `dispatcherSubscribesTo` 守衛，於 `guildCreate` 已被 plugin 訂閱時跳過
    顯式 `client.on`，避免雙重 onboarding。刪除 `src/events/guild_event.ts`。
  - D3 — 刪除整個 `src/events/` 過渡層（`earthquake.ts`、`guild_event.ts`、
    `index.ts`）；移除 `tsconfig.json`、`tsconfig.strict.json`、`knip.json`
    的 `@event` path 對映與三條 `src/events/*` knip ignore。全 repo
    `grep "@event"` 為 0。
  - D4 — 完成 `src/utils/{bot_cmd,job_manager,misc}` callsite 盤點（步驟
    1）；`JobManager` / `misc` 的最終承接位置待 C1 / C9 評估後遷移。
- **影響**：behavior-equivalent。`guildCreate` onboarding 改由 plugin 經
  typed port 驅動，不再穿透 `BaseBot` 內部結構；無 plugin 的 bot（Tomori）
  仍經 `BaseBot.guildCreateListener` 走 port。`src/events/` 與 `@event`
  alias 移除。C10 D3（CJK scanner `SCOPED_DIRECTORIES` 移除 `src/events`）
  待承接。

---

## 2026-05-21 — C11 D1/D2/D5 落地（bot composition root 缺口收斂）

- **元件**：C11 Bot Composition Roots
- **缺口**：D1（C11 切片）、D2（C11 切片）、D5（C11 切片）
- **變更**：
  - **D1** — 新增 `src/bot/guild-onboarding.ts`：`BaseBotGuildOnboardingPort`
    以 Adapter 模式實作 `core/plugin` 的 `GuildOnboardingPort`，收斂新加入
    guild 的 `guildInfo` slot 初始化、`connectOneGuild` DB 連線、command
    註冊。`BaseBot` 建構子將其註冊為 `TOKENS.GuildOnboardingPort`
    singleton；`guildCreateListener` 改經 port 分流，不再呼叫 legacy
    `detectGuildCreate`。
  - **D2** — `nijika` 改以 `createEarthquakePlugin({ port })` 組裝地震速報；
    `src/bot/nijika/index.ts` 移除 inline `express()` server、`app.listen()`
    與 `r.post('/discord/earthquake', ...)` 路由。`Nijika` 建構子新增
    `webhookPort` 參數，由 `index.ts` 以 `loadEnv({ requirePort: true })`
    取得的 `Env.PORT` 傳入。
  - **D5** — 移除 `BaseBot.disabledGuilds` 唯讀 getter（C6 切片完成後已無
    消費端）；disabled 狀態統一由 `ConnectionManager` 提供，handler 端經
    保留的 `BaseBot.connectionManager` getter 查詢。
  - knip 設定將 `src/events/{earthquake,guild_event,index}.ts` 暫列 `ignore`：
    D1/D2 吸收其行為後該目錄已成孤兒，待 D3（C8/C10）刪除目錄與 `@event`
    alias 時一併移除此 ignore。
- **影響**：行為等價。`guildCreateListener` 由 fire-and-forget 改為 `await`
  port，DB 連線失敗改為經 `listen()` 的 `.catch(logError)` 落入結構化日誌
  （原為浮動 promise），錯誤處理更穩健、對使用者行為無變。D4 子任務未處理
  （依賴 C8 D4，延後）。

## 2026-05-21 — C6 D5/D7/D9 落地（handler 缺口收斂）

- **元件**：C6 Handlers
- **缺口**：D5（C6 切片）、D7（方案 A）、D9（方案 B）
- **變更**：
  - **D5** — `requireGuildRepos` 的 disabled-guild 守衛改讀
    `bot.connectionManager?.isDisabled(...)`,不再經 `BaseBot.disabledGuilds`
    getter;`traceId` 直接取自 `ConnectionManager`。`BaseBot` 新增唯讀
    `connectionManager` getter(對齊 `translator`/`logger`/`env` 模式,使
    handler 層免於 import IoC 容器)。
  - **D7** — 指令 metadata 去 CJK literal。`CommandConfig` /
    `CommandOption` 的 `description` 改為選填,由新 helper
    `localizeCommandConfig(config, translator)` 從 `commands` 命名空間
    catalog 解析(key 依命令/選項名稱推導),回傳 `LocalizedCommandConfig`;
    `buildCommandJsonBody` 改收 `LocalizedCommandConfig`;`getCommandJsonBody`
    / `deploy.ts` / `help` 於 build 時解析。context-menu 指令顯示名稱由
    `commands:<id>.name` 解析(`config.name` 改存 ASCII id,`registerCommands`
    以 localized 名稱作 `commandHandlers` key)。`change_avatar` /
    `random_restaurant` 的 CJK-valued choices 移至 colocated JSON 資料檔;
    其餘 ASCII-valued choices 的 CJK 顯示名稱補入 `commands.json` 的
    `choices` key(`zh-TW` + `en` 雙語)。`src/handlers/` 指令 metadata
    已無 `// i18n-ignore`。指令 metadata/型別自 `commands/index.ts` 抽至
    新檔 `commands/command.ts`(切斷對 generated registry 的依賴鏈)。
  - **D9** — 新增 handler 邊界 helper `replyForError` /
    `resolveErrorReply`（`src/handlers/reply-for-error.ts`):operator
    通道恆記結構化 log + `traceId`(新增 `ops.router.handlerError`);
    user 通道對 `DomainError` 依 `messageKey` 回覆、對非 `DomainError`
    回退 `replies:<feature>.failed` 並附 `traceId`。31 個指令 handler +
    `modals/ai_settings` 的 catch 改為 `replyForError(...)`
    (`random_restaurant` 保留專屬時段回退 UX)。
  - **測試** — 新增 `test/unit/handlers/` 三個 unit 套件(`replyForError`
    雙通道、`localizeCommandConfig`、`requireGuildRepos` D5);`vitest`
    workspace 補齊 handler 路徑 alias 使 handler 層可單元測試。
- **影響**：handler 對 `DomainError` 改依 taxonomy 回覆、非 `DomainError`
  之 `.failed` 回退附錯誤代碼(D9 明文允許的行為變更);其餘對外行為等價
  —— 部署的指令 JSON 字串與重構前一致。

## 2026-05-21 — C5 D5 落地（`ConnectionManager` retry / 降級分類）

- **元件**：C5 Infra Adapters
- **缺口**：D5（方案 A）
- **變更**：`ConnectionManager`（`MongoConnectionManager` /
  `StaticConnectionManager`）內建 transient/persistent 降級。新增
  `isTransient(error: DatabaseError)` helper 於
  `src/persistence/error-translator.ts`（依 `DATABASE_TIMEOUT` /
  `DATABASE_NETWORK` sub-code 判定）。`getConnection` 對 transient 失敗做
  有上限的指數退避重試（`RetryPolicy`：預設 3 次 / 200ms / 2s 上限,
  建構子可注入；`SleepFn` 可注入使測試零等待）;重試耗盡或 persistent
  失敗則把 `guildId` 標記 disabled、自行生成 `traceId`、寫一行 operator
  stderr。新增 `isDisabled(guildId): DisabledGuildState | undefined` 對外
  可查;disabled 後 `getConnection` 短路丟同一 `DatabaseError`,
  `close` / `closeAll` 清除 marker。retry 迴圈抽為共用 `retryOpen` free
  function,兩個 manager 共用同一韌性實作。`BaseBot` 退化為查詢端：移除
  自持的 `disabledGuilds` map 與 `connectOneGuild` 的 catch-記錄寫入,
  `disabledGuilds` 改為投影 `ConnectionManager.isDisabled` 的唯讀 getter。
- **影響**：四個 bot 對外行為等價——壞 URI 的 guild 仍最終 disabled、
  handler 經 `requireGuildRepos` 回 `errors:db.guild_disabled` 附
  `traceId`,差異僅在 transient 失敗多了重試、`traceId` 改由
  `ConnectionManager` 生成。per-URI 共用語意：共用同一 base URI 的 bot
  共用同一 `disabled` set。`requireGuildRepos`（C6 D5）與 `BaseBot` 完整
  退化（C11 D5）的讀取來源收斂為後續任務。

## 2026-05-21 — C4 G-2 落地（repository 邊界 `Result` 一致性）

- **元件**：C4 Persistence
- **缺口**：G-2
- **變更**：七個 repository 邊界（activity / fetch / giveaway / message /
  reply / todo / user-api-setting）統一改回 `Result<T, DatabaseError>`：
  介面方法簽章與 `MongoXRepo` 實作以 try/catch 包裹 mongoose 呼叫,錯誤經
  `databaseErrorFrom` 包成 `err(DatabaseError)`,成功回 `ok(...)`,查無資料
  為 `ok(undefined)`。mongoose error-translator 自
  `src/infra/mongo/error-translator.ts` 搬至
  `src/persistence/error-translator.ts`,使七個 repo 無須反向 import
  `infra/mongo`。所有 repo callsite（handler / plugin 委派邏輯）改以
  `result.ok` 判斷,`err` 重擲入既有 catch。各 repo integration test 補
  `err(DatabaseError)` 路徑覆蓋,error-translator 單元測試移至
  `test/unit/persistence/`。HLD §7.2、C4 設計檔 §7 與實作對齊。
- **影響**：repository 公開介面簽章變更（回傳型別包上 `Result`）;程式員
  錯誤仍走 `TypeError`,不進 `Result`。四個 bot 對外行為等價——`err` 在
  callsite 重擲後走原本的 log + 失敗回覆路徑。

## 2026-05-21 — C7 D7 + D9 落地（雙語系 i18n catalog）

- **元件**：C7 i18n Catalog
- **缺口**：D7、D9
- **變更**：填 `zh-TW/commands.json` 指令 metadata key（描述 / 選項描述 /
  穩定 value choices）;新建 `src/i18n/locales/en/{commands,errors,replies}.json`
  並把 `zh-TW` 全部 key 英譯。每個指令 feature 補有語氣的
  `replies:<feature>.failed` 回退文案,一律帶 `{{traceId}}` 內插位。新增
  `test/i18n/catalog-runtime.test.ts` 以實際載入管線驗證 en 解析、雙語系零缺
  key、缺 key 回退。C7 設計檔與 `CONTRIBUTING.md` 明示雙語系維護負擔。
- **影響**：catalog 新增 key（commands 命名空間、`en/` 語系、per-feature
  `failed` 回退）;handler 端去 literal 與 `replyForError` 屬 C6 範圍。
  `failed` 文案新增 `{{traceId}}` 屬 D9 明示的允許行為變更,其餘文案語意不變。

## 2026-05-21 — C10 D8 落地（strict tsconfig 涵蓋全 src）

- **元件**：C10 Quality Gates
- **缺口**：D8
- **變更**：`tsconfig.strict.json` 的 `include` 改為 `src/**/*`，並補入 path
  alias。掃除 `src/handlers/` 在 strict 模式下的 `noUncheckedIndexedAccess` /
  `noUnusedParameters` / 未使用 import 違規。
- **影響**：行為等價——handler 邏輯不變，僅補 narrowing 與移除死碼。

## 2026-05-21 — C8 D2（earthquake plugin）+ G-1 落地

- **元件**：C8 Plugins
- **缺口**：D2、G-1
- **變更**：新增 `src/plugins/earthquake/`——`createEarthquakePlugin` 工廠、
  `start` hook 內的 Express `/discord/earthquake` 路由、`internal/broadcast.ts`
  的 per-guild 廣播邏輯（自 legacy `events/earthquake.ts` 遷入）。giveaway /
  activity 的 `msgReact` 改用結構化 logger。
- **影響**：行為等價——地震廣播語意不變；`nijika` 仍經 legacy inline 路由（待 C11
  D2 切換後再移除 `events/earthquake.ts`）。

## 2026-05-21 — C3 D1 介面 + D6 落地

- **元件**：C3 Plugin Runtime
- **缺口**：D1（介面）、D6
- **變更**：新增 `src/core/plugin/guild-onboarding-port.ts`（`GuildOnboardingPort`
  介面）與 `TOKENS.GuildOnboardingPort`；抽出 `host/lifecycle.ts` 的
  `PluginLifecycleRunner`（經窄介面 `LifecycleHost` 注入）；`cascadeDisable`
  移入 `host/topology.ts` 成為純函式；`host.ts` 生命週期方法改為薄委派。
- **影響**：行為等價——生命週期執行語意不變，僅結構重組。

## 2026-05-21 — 補上 auto-merge reconciliation 規則

- **元件**：C10 Quality Gates / 工程團隊
- **缺口**：—
- **變更**：明確規範 auto-merge 非 fire-and-forget——check 失敗時 PR 會停在
  OPEN。`engineering-orchestrator` agent 新增「Auto-merge reconciliation」段落
  （追蹤待結 PR、依賴工作以 `MERGED` 為前置條件、失敗則 push 修正至同分支）；
  `CONTRIBUTING.md` 補上失敗 PR 的處理說明。
- **影響**：行為等價（無 `src/` 變更）。修正先前「派完 PR 即不理會」的不完整
  描述。

## 2026-05-21 — 啟用 auto-merge 為預設合併方式

- **元件**：C10 Quality Gates
- **缺口**：—
- **變更**：repo 啟用 GitHub auto-merge；定 `gh pr merge --auto --merge` 為
  預設合併方式。`CONTRIBUTING.md`、`docs/design/C10-quality-gates.md` §2.8、
  `engineering-orchestrator` agent 一併記載。
- **影響**：行為等價（無 `src/` 變更）。PR 排入 auto-merge 後，10 個 required
  check 全綠即由 GitHub 自動合併；auto-merge 不繞過 branch protection。

## 2026-05-21 — 設定 required status check

- **元件**：C10 Quality Gates
- **缺口**：—
- **變更**：為 `refactor/architecture-overhaul` 加上 branch protection，把全部
  10 個 CI job 設為 required status check（`strict: false`、不要求人工 review）。
  `CONTRIBUTING.md`「Quality gates」與 `docs/design/C10-quality-gates.md` §2.8
  記載此政策；並指出 `main` 的 protection 仍有過時 check 名稱待修正。
- **影響**：行為等價（無 `src/` 變更）。此後進 `refactor/architecture-overhaul`
  的 PR 須 10 個 CI 閘門全綠才能合併。

## 2026-05-21 — 補齊 session 銜接入口

- **元件**：工程基礎建設（非 C1–C11 任一）
- **缺口**：—
- **變更**：新增 `docs/tasks/README.md`（工程單一進入點）；`CLAUDE.md` 新增
  「Active engineering: gap-remediation」段落並更新 agent/skill 區塊；重寫
  `.claude/agents/` 6 個 reviewer 為現行架構（英文）；寫入專案 memory。
- **影響**：行為等價（無 `src/` 程式碼變更）。新 session 可從 `CLAUDE.md` →
  `docs/tasks/README.md` 無縫接手。

## 2026-05-21 — 建立工程子 agent 團隊與 skills

- **元件**：工程基礎建設（非 C1–C11 任一）
- **缺口**：—
- **變更**：新增 `.claude/agents/engineering-orchestrator.md`、
  `.claude/agents/component-implementer.md` 兩個工程 agent；填入
  `.claude/skills/{project-conventions,coding-standards,gap-task-workflow,update-wiki}/SKILL.md`
  四個 skill；建立 `docs/wiki/`（Home、CHANGELOG、11 個元件頁）。
- **影響**：行為等價（無 `src/` 程式碼變更）。建立缺口收斂工程的自主執行團隊
  與規範。

## 2026-05-20 — 建立缺口收斂任務劃分

- **元件**：—
- **缺口**：D1–D9、G-1、G-2
- **變更**：建立 `docs/tasks/`（11 個元件任務檔 + `progress.md`），把
  `docs/design/gaps.md` 的缺口按元件切分為 check list 子任務。
- **影響**：行為等價（純文件）。
