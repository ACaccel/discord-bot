# C9 — Codegen & Scripts

> 路徑：`scripts/` ｜詳細設計：[`docs/design/C9-codegen-scripts.md`](../../design/C9-codegen-scripts.md) ｜任務：[`docs/tasks/C9-codegen-scripts.md`](../../tasks/C9-codegen-scripts.md)

## 職責

建置期工具：`gen-registry.ts` 掃描 handlers 產生 `registry.generated.ts`；`smoke.ts` pre-deploy 探針。

## 現況

設計檔判定無偏差。待辦：D4 — 評估 `bot_cmd.ts` 是否遷入 `scripts/`（條件性，待 C8 D4 盤點）。

## 近期變更

- 2026-05-21 — 建立元件 wiki 頁（工程基礎建設）。
