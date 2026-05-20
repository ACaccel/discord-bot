# C10 — Quality Gates

> 路徑：`CI workflow + tsconfig / eslint / vitest / package.json` ｜詳細設計：[`docs/design/C10-quality-gates.md`](../../design/C10-quality-gates.md) ｜任務：[`docs/tasks/C10-quality-gates.md`](../../tasks/C10-quality-gates.md)

## 職責

以 CI gate 橫切強制全 repo 品質：typecheck、lint、format、codegen drift、knip、test、coverage、CJK scanner、security、smoke。

## 現況

待辦：D3 — `src/events/` 刪除後從 CJK scanner `SCOPED_DIRECTORIES` 移除之；D8 — strict tsconfig 涵蓋全 `src`。

## 近期變更

- 2026-05-21 — 建立元件 wiki 頁（工程基礎建設）。
