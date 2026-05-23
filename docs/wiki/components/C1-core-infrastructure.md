# C1 — Core Infrastructure

> 路徑：`src/core/（除 ioc/、plugin/）` ｜詳細設計：[`docs/design/C1-core-infrastructure.md`](../../design/C1-core-infrastructure.md) ｜任務：[`docs/tasks/C1-core-infrastructure.md`](../../tasks/C1-core-infrastructure.md)

## 職責

分層架構最底層，提供與業務無關、與第三方 SDK 無關的純基礎設施：config / errors / result / i18n / logger / time / ids / guild-registry / scheduling。

## 現況

設計檔判定無實質偏差。D4 已落地：`src/utils/job_manager.ts` 的 `JobManager`
與 `misc.ts` 的 `parseDuration` 經評估無 Discord / Mongoose 相依（僅依賴
`node-schedule`），已遷入 `src/core/scheduling/`（`job-manager.ts`、`duration.ts`、
barrel `index.ts`），經 `@core/scheduling` 由 giveaway / activity plugin 共用。

## 近期變更

- 2026-05-24 — R6.2：`ConfigurationError` 新增 codes `BOT_LOGIN_FAILED`
  與 `BOT_LOGIN_NO_USER`，配合 `BaseBot.login` 失敗 reject。對應 i18n
  keys `errors:bot.login_failed` / `errors:bot.login_no_user` 同步加入
  zh-TW 與 en catalog (tech-debt R6.2)
- 2026-05-24 — R6.3：`src/core/config/bootstrap-logger.ts` 改由
  `src/deploy.ts` 主動取用（取代既有 23 處 `console.*` 自由輸出） (tech-debt R6.3)
- 2026-05-21 — D4：新增 `src/core/scheduling/` 子模組，承接 `JobManager` 與
  `parseDuration`；單元測試達 core 覆蓋門檻（行 / 函式 / 敘述 / 分支皆 100%）。
- 2026-05-21 — 建立元件 wiki 頁（工程基礎建設）。
