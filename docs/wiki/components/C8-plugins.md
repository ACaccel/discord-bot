# C8 — Plugins

> 路徑：`src/plugins/` ｜詳細設計：[`docs/design/C8-plugins.md`](../../design/C8-plugins.md) ｜任務：[`docs/tasks/C8-plugins.md`](../../tasks/C8-plugins.md)

## 職責

自足的業務功能模組，所有業務行為皆歸此元件，現有 8 個 plugin 各符合 `Plugin<Config>` 契約。

## 現況

待辦：D1 — guild-events 訂閱 guildCreate；D2 — 新建 earthquake plugin；D3 — 移除 `src/events/`；D4 — 收斂 `src/utils/`；G-1 — `msgReact` 改結構化 logger。

## 近期變更

- 2026-05-21 — 建立元件 wiki 頁（工程基礎建設）。
