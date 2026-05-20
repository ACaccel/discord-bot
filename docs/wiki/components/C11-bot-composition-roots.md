# C11 — Bot Composition Roots

> 路徑：`src/bot/` ｜詳細設計：[`docs/design/C11-bot-composition-roots.md`](../../design/C11-bot-composition-roots.md) ｜任務：[`docs/tasks/C11-bot-composition-roots.md`](../../tasks/C11-bot-composition-roots.md)

## 職責

唯一 wiring 層：`BaseBot` 生命週期擁有者 + 四個 bot 各自挑選 plugin 集合 + middlewares + deploy。

## 現況

待辦：D1 — `BaseBot` 提供 guild-onboarding port 實作；D2 — nijika 改用 earthquake plugin；D4 — 移除 `@utils` alias / 更新 CLAUDE.md；D5 — `BaseBot` 退化為 disabled-guild 查詢端。

## 近期變更

- 2026-05-21 — 建立元件 wiki 頁（工程基礎建設）。
