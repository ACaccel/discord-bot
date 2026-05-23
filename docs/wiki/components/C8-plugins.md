# C8 — Plugins

> 路徑：`src/plugins/` ｜詳細設計：[`docs/design/C8-plugins.md`](../../design/C8-plugins.md) ｜任務：[`docs/tasks/C8-plugins.md`](../../tasks/C8-plugins.md)

## 職責

自足的業務功能模組，所有業務行為皆歸此元件，現有 8 個 plugin 各符合 `Plugin<Config>` 契約。

## 現況

- D1 已落地：`guild-events` plugin 新增 `events.guildCreate` 訂閱，經
  `ctx.resolve(TOKENS.GuildOnboardingPort)` 取 port 完成新 guild 初始化；
  失敗只記結構化 log、不重擲。`BaseBot.listen` 於該事件已被 plugin 訂閱時
  跳過顯式 `client.on(GuildCreate)`，避免雙重 onboarding。
- D2 已落地：新建 `src/plugins/earthquake/`（`createEarthquakePlugin`，
  `scope='bot'`）。`start` hook 擁有 Express `/discord/earthquake` 路由與
  per-guild 廣播；廣播邏輯在 `internal/broadcast.ts`。`onShutdown` 關閉 socket。
  `nijika` 組裝改動見 C11。
- D3 已落地：`src/events/` 過渡層整個刪除（`earthquake.ts`、`guild_event.ts`、
  `index.ts`）；移除 `tsconfig.json` / `tsconfig.strict.json` / `knip.json` 的
  `@event` path 對映與三條 `src/events/*` knip ignore。全 repo `@event` 為 0。
- G-1 已落地：giveaway / activity 的 `msgReact` 改用注入的結構化 `Logger`，
  `src/plugins/` 不再有 raw `console.*`。
- D4 已落地：`src/utils/` 整個退場。giveaway / activity 的 `internal/` 改 import
  `@core/scheduling` 取得 `JobManager` / `parseDuration`，不再依賴 `utils/*`；
  `JobManager` / `parseDuration` 遷入 `core/scheduling/`，`bot_cmd.ts` /
  `misc.ts` 的 handler 專用函式遷入 `src/handlers/commands/`，knip 死碼
  （`tts_api` / `listChannels` / `deleteJob` / `getRandomInterval`）刪除。

## 現況補充（R2 後）

- `plugins/voice/`：刪除 `internal/active-controller.ts` 模組全域
  `let active`；`plugin.ts.init` 改以
  `ctx.registerInstance(TOKENS.VoiceController, ...)` 註冊。
  `internal/index.ts` 不再 re-export `setActive*` / `getActive*`。
- `plugins/llm-chat/plugin.ts.init` 以
  `ctx.registerInstance(TOKENS.ModelCatalog, ...)` 取代
  `setActiveModelCatalog(...)`；不再 import `infra/llm` 的
  `setActiveModelCatalog` symbol。
- 全 repo `grep "let active" src/plugins src/infra` 為 0；
  plugin → BaseBot 通訊統一走 IoC 容器。

## 現況補充（R3 後）

- 8 個 `src/plugins/*/plugin.ts`（`auto-reply` / `activity` / `giveaway` /
  `guild-events` / `llm-chat` / `message-backup` / `voice` / `earthquake`）
  全部改 `import { TOKENS } from '../../core/plugin'`；不再有任何
  `src/plugins/**` 對 `core/ioc` 的直接 import。
- ESLint `src/plugins/**` block 的 `no-restricted-imports` 把
  `**/core/ioc` 與 `@core/ioc` 列入禁區並給 plugin 專屬錯誤訊息。

## 近期變更

- 2026-05-24 — R3：8 個 plugin 把 `TOKENS` import 來源切到
  `core/plugin` barrel；新增 ESLint guard 把 `core/ioc` 對
  `src/plugins/**` 列入禁區 (tech-debt R3)
- 2026-05-24 — R2：voice / llm-chat 兩個 plugin 改走
  `PluginInitContext.registerInstance`；刪除 `voice/internal/
active-controller.ts`；模組全域 `let active*` 旁路歸零
  (tech-debt R2)
- 2026-05-21 — D4 落地：`src/utils/` 目錄刪除；plugin internal 改用
  `@core/scheduling`，承接點分屬 C1（`core/scheduling/`）與 C6（handler 工具）。
- 2026-05-21 — D1 + D3 落地：`guild-events` 訂閱 `guildCreate` 並經
  guild-onboarding port 初始化新 guild；刪除整個 `src/events/` 過渡層與
  `@event` alias。
- 2026-05-21 — D2 + G-1 落地：新增 earthquake plugin；`msgReact` 去 `console.error`。
- 2026-05-21 — 建立元件 wiki 頁（工程基礎建設）。
