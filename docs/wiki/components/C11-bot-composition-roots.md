# C11 — Bot Composition Roots

> 路徑：`src/bot/` ｜詳細設計：[`docs/design/C11-bot-composition-roots.md`](../../design/C11-bot-composition-roots.md) ｜任務：[`docs/tasks/C11-bot-composition-roots.md`](../../tasks/C11-bot-composition-roots.md)

## 職責

唯一 wiring 層：`BaseBot` 生命週期擁有者 + 四個 bot 各自挑選 plugin 集合 + middlewares + deploy。

## 現況

- R1：`BaseBot` 已退回 thin lifecycle owner（592 行，3 個 collaborator）。
  - `src/bot/guild-registrar.ts`：`GuildRegistrar` 組裝 `GuildInfo`（純 assembly，
    不開 Mongo、不送 Discord）。
  - `src/bot/client-event-bridge.ts`：`ClientEventBridge` 以 Adapter 將
    `client.on(...)` raw event 翻譯為 router dispatch / EventDispatcher emit /
    `ReactionHandlerPort` call；單一 `attach`/`detach` 入口，重複 attach
    丟 `TypeError`（contract violation）。
  - `src/bot/guild-db-connector.ts`：`GuildDbConnector` 控制 per-guild Mongo
    fan-out 與失敗 normalisation；`connectAll` resilient（per-slot 失敗只 log）。
  - Subclass 透過 protected hook `eventBridgeSuppression()` 關閉不需要的 raw
    listener，取代過去以 `override interactionEventListener = () => {}` 抑制
    listener 的舊作法（Konata / MsgArchive 已遷移）。
- R6.4 / R6.5（隨 R1 commit）：Handler Map 已一律複數（`buttonHandlers` 等），
  `help_msg → helpMessage`；`src/bot/index.ts` import 區連續無夾雜，
  `sharedConnectionManagers` helper 搬至 import 區之後。
- `BaseBot` 在建構子註冊 7 個 singleton 加 `GuildOnboardingPort`（D1）；
  port 實作 `BaseBotGuildOnboardingPort`（`src/bot/guild-onboarding.ts`）
  以 Adapter 模式包裝 `BaseBot`，收斂新加入 guild 的 DB 連線與 command 註冊。
- `nijika` 以 `createEarthquakePlugin({ port })` 組裝地震速報；`nijika/index.ts`
  不再 inline `app.listen()` 與 `/discord/earthquake` 路由（D2）。
- `BaseBot` 已移除 `disabledGuilds` 唯讀 getter；disabled 狀態統一由
  `ConnectionManager` 提供，handler 端經 `BaseBot.connectionManager` getter
  查詢（D5）。
- D4 已落地：`src/utils/` 退場後，移除 `tsconfig.json` / `tsconfig.strict.json` /
  `knip.json` / `vitest` 的 `@utils` path 對映；`CLAUDE.md` 目錄說明與 alias 表
  更新為現況（移除過時的「`utils/` 僅 `logger.ts` strict」敘述）。

## 近期變更

- 2026-05-24 — R5：新增 `src/bot/locales-dir.ts`（`resolveLocalesDir()` 合成根 helper）；`BaseBot` 建構子新增 `localesDir: string = resolveLocalesDir()` 參數並保存為私有欄位，`buildHost` 內以 `createDefaultTranslator({ localesDir: this.localesDir })` 取代無參數呼叫。`src/deploy.ts` 透過同一 helper 注入路徑。四個 bot 子類 ctor 呼叫不需改動（既有 `super(...)` 走預設值）(tech-debt R5)
- 2026-05-24 — R2：`BaseBot.voice` 由 public field 改為 getter，
  經 `container.tryResolve(TOKENS.VoiceController)` 取得；新增
  symmetric getter `modelCatalog`（`TOKENS.ModelCatalog`）。`run()`
  內 `this.voice = getActiveVoiceController()` 後置同步刪除；
  `bot.voice` / `bot.modelCatalog` 對 msg-archive 等不註冊對應
  plugin 的 bot 自然回傳 `undefined` (tech-debt R2)
- 2026-05-24 — R1：將 `BaseBot` 拆解為 thin lifecycle owner +
  `GuildRegistrar` / `ClientEventBridge` / `GuildDbConnector`；同 commit 套用
  R6.4（Handler Map 複數命名）與 R6.5（import 排序）；Konata / MsgArchive
  以 `eventBridgeSuppression()` hook 取代 listener override。新增 5 個 spec
  共 31 案例（unit × 3 + integration × 2）(tech-debt R1)
- 2026-05-21 — D4：移除 `@utils` alias 與 `vitest` 對映，更新 CLAUDE.md 目錄
  說明與 alias 表 (gap D4)

- 2026-05-21 — D1：新增 `src/bot/guild-onboarding.ts`（`BaseBotGuildOnboardingPort`），
  註冊 `TOKENS.GuildOnboardingPort`，`guildCreateListener` 改用 port (gap D1)
- 2026-05-21 — D1（C8 協調）：`BaseBot.listen` 新增 `dispatcherSubscribesTo`
  守衛，於 `guildCreate` 已被 `guild-events` plugin 訂閱時跳過顯式
  `client.on(GuildCreate)`，避免 plugin 與 BaseBot 雙重 onboarding (gap D1)
- 2026-05-21 — D2：`nijika` 改以 earthquake plugin 組裝，移除 inline Express
  地震路由 (gap D2)
- 2026-05-21 — D5：移除 `BaseBot.disabledGuilds` 唯讀 getter，完成查詢端退化 (gap D5)
- 2026-05-21 — 建立元件 wiki 頁（工程基礎建設）。
