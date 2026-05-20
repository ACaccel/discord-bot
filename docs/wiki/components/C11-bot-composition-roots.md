# C11 — Bot Composition Roots

> 路徑：`src/bot/` ｜詳細設計：[`docs/design/C11-bot-composition-roots.md`](../../design/C11-bot-composition-roots.md) ｜任務：[`docs/tasks/C11-bot-composition-roots.md`](../../tasks/C11-bot-composition-roots.md)

## 職責

唯一 wiring 層：`BaseBot` 生命週期擁有者 + 四個 bot 各自挑選 plugin 集合 + middlewares + deploy。

## 現況

- `BaseBot` 在建構子註冊 7 個 singleton 加 `GuildOnboardingPort`（D1）；
  port 實作 `BaseBotGuildOnboardingPort`（`src/bot/guild-onboarding.ts`）
  以 Adapter 模式包裝 `BaseBot`，收斂新加入 guild 的 DB 連線與 command 註冊。
  `guildCreateListener` 改經此 port 分流，不再穿透 `detectGuildCreate`。
- `nijika` 以 `createEarthquakePlugin({ port })` 組裝地震速報；`nijika/index.ts`
  不再 inline `app.listen()` 與 `/discord/earthquake` 路由（D2）。
- `BaseBot` 已移除 `disabledGuilds` 唯讀 getter；disabled 狀態統一由
  `ConnectionManager` 提供，handler 端經 `BaseBot.connectionManager` getter
  查詢（D5）。
- 待辦：D4 — 移除 `@utils` alias / 更新 CLAUDE.md（依賴 C8 D4，延後）。

## 近期變更

- 2026-05-21 — D1：新增 `src/bot/guild-onboarding.ts`（`BaseBotGuildOnboardingPort`），
  註冊 `TOKENS.GuildOnboardingPort`，`guildCreateListener` 改用 port (gap D1)
- 2026-05-21 — D1（C8 協調）：`BaseBot.listen` 新增 `dispatcherSubscribesTo`
  守衛，於 `guildCreate` 已被 `guild-events` plugin 訂閱時跳過顯式
  `client.on(GuildCreate)`，避免 plugin 與 BaseBot 雙重 onboarding (gap D1)
- 2026-05-21 — D2：`nijika` 改以 earthquake plugin 組裝，移除 inline Express
  地震路由 (gap D2)
- 2026-05-21 — D5：移除 `BaseBot.disabledGuilds` 唯讀 getter，完成查詢端退化 (gap D5)
- 2026-05-21 — 建立元件 wiki 頁（工程基礎建設）。
