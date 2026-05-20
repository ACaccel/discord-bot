# C8 — Plugins

> 路徑：`src/plugins/` ｜詳細設計：[`docs/design/C8-plugins.md`](../../design/C8-plugins.md) ｜任務：[`docs/tasks/C8-plugins.md`](../../tasks/C8-plugins.md)

## 職責

自足的業務功能模組，所有業務行為皆歸此元件，現有 8 個 plugin 各符合 `Plugin<Config>` 契約。

## 現況

- D2 已落地：新建 `src/plugins/earthquake/`（`createEarthquakePlugin`，
  `scope='bot'`）。`start` hook 擁有 Express `/discord/earthquake` 路由與
  per-guild 廣播；廣播邏輯在 `internal/broadcast.ts`。`onShutdown` 關閉 socket。
  `nijika` 組裝改動見 C11。
- G-1 已落地：giveaway / activity 的 `msgReact` 改用注入的結構化 `Logger`，
  `src/plugins/` 不再有 raw `console.*`。
- 待辦：D1 — guild-events 訂閱 guildCreate；D3 — 移除 `src/events/`；
  D4 — 收斂 `src/utils/`。

## 近期變更

- 2026-05-21 — D2 + G-1 落地：新增 earthquake plugin；`msgReact` 去 `console.error`。
- 2026-05-21 — 建立元件 wiki 頁（工程基礎建設）。
