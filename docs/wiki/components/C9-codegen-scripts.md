# C9 — Codegen & Scripts

> 路徑：`scripts/` ｜詳細設計：[`docs/design/C9-codegen-scripts.md`](../../design/C9-codegen-scripts.md) ｜任務：[`docs/tasks/C9-codegen-scripts.md`](../../tasks/C9-codegen-scripts.md)

## 職責

建置期工具：`gen-registry.ts` 掃描 handlers 產生 `registry.generated.ts`；`smoke.ts` pre-deploy 探針。

## 現況

設計檔判定無偏差。D4 已評估：`bot_cmd.ts` 的 `buildCommandJsonBody` 雖在
`deploy.ts`（build 期）使用，但同時由 `handlers/commands/index.ts` 在 runtime
command 註冊路徑消費，且其輸入型別 `LocalizedCommandConfig` 屬 handler 契約，
故裁定承接於 C6 handler 側（`src/handlers/commands/command-builder.ts`），不遷入
`scripts/`；`scripts/` 維持「不參與 runtime」的邊界規則。

## 近期變更

- 2026-05-24 — R6.3：`src/deploy.ts` 全面改用 `createBootstrapLogger`
  發送結構化 pino 行（含 status / warn / error / fatal 路徑），取代
  既有 15 處 `console.*` 自由文字輸出 (tech-debt R6.3)
- 2026-05-21 — D4：評估 `bot_cmd.ts` 承接點，裁定歸 C6 handlers（runtime 消費），
  `scripts/` 不承接;此元件 D4 子任務標記為「評估完成、不適用遷入」。
- 2026-05-21 — 建立元件 wiki 頁（工程基礎建設）。
