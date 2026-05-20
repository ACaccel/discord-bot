# Wiki 變更日誌

倒序記錄（最新在上）。每次程式碼 / 文件的結構性變更由
[`update-wiki`](../../.claude/skills/update-wiki/SKILL.md) skill 追加一筆。

---

## 2026-05-21 — 設定 required status check

- **元件**：C10 Quality Gates
- **缺口**：—
- **變更**：為 `refactor/architecture-overhaul` 加上 branch protection，把全部
  10 個 CI job 設為 required status check（`strict: false`、不要求人工 review）。
  `CONTRIBUTING.md`「Quality gates」與 `docs/design/C10-quality-gates.md` §2.8
  記載此政策；並指出 `main` 的 protection 仍有過時 check 名稱待修正。
- **影響**：行為等價（無 `src/` 變更）。此後進 `refactor/architecture-overhaul`
  的 PR 須 10 個 CI 閘門全綠才能合併。

## 2026-05-21 — 補齊 session 銜接入口

- **元件**：工程基礎建設（非 C1–C11 任一）
- **缺口**：—
- **變更**：新增 `docs/tasks/README.md`（工程單一進入點）；`CLAUDE.md` 新增
  「Active engineering: gap-remediation」段落並更新 agent/skill 區塊；重寫
  `.claude/agents/` 6 個 reviewer 為現行架構（英文）；寫入專案 memory。
- **影響**：行為等價（無 `src/` 程式碼變更）。新 session 可從 `CLAUDE.md` →
  `docs/tasks/README.md` 無縫接手。

## 2026-05-21 — 建立工程子 agent 團隊與 skills

- **元件**：工程基礎建設（非 C1–C11 任一）
- **缺口**：—
- **變更**：新增 `.claude/agents/engineering-orchestrator.md`、
  `.claude/agents/component-implementer.md` 兩個工程 agent；填入
  `.claude/skills/{project-conventions,coding-standards,gap-task-workflow,update-wiki}/SKILL.md`
  四個 skill；建立 `docs/wiki/`（Home、CHANGELOG、11 個元件頁）。
- **影響**：行為等價（無 `src/` 程式碼變更）。建立缺口收斂工程的自主執行團隊
  與規範。

## 2026-05-20 — 建立缺口收斂任務劃分

- **元件**：—
- **缺口**：D1–D9、G-1、G-2
- **變更**：建立 `docs/tasks/`（11 個元件任務檔 + `progress.md`），把
  `docs/design/gaps.md` 的缺口按元件切分為 check list 子任務。
- **影響**：行為等價（純文件）。
