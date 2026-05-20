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
- D4 部分進行中：完成 `src/utils/{bot_cmd,job_manager,misc}` callsite 盤點；
  `JobManager` 與 `misc` 的最終承接位置依賴 C1 / C9 評估，尚未遷移。

## 近期變更

- 2026-05-21 — D1 + D3 落地：`guild-events` 訂閱 `guildCreate` 並經
  guild-onboarding port 初始化新 guild；刪除整個 `src/events/` 過渡層與
  `@event` alias。D4 完成 callsite 盤點（待 C1 / C9 承接評估）。
- 2026-05-21 — D2 + G-1 落地：新增 earthquake plugin；`msgReact` 去 `console.error`。
- 2026-05-21 — 建立元件 wiki 頁（工程基礎建設）。
