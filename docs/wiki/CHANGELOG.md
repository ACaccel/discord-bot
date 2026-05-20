# Wiki 變更日誌

倒序記錄（最新在上）。每次程式碼 / 文件的結構性變更由
[`update-wiki`](../../.claude/skills/update-wiki/SKILL.md) skill 追加一筆。

---

## 2026-05-21 — C3 D1 介面 + D6 落地

- **元件**：C3 Plugin Runtime
- **缺口**：D1（介面）、D6
- **變更**：新增 `src/core/plugin/guild-onboarding-port.ts`（`GuildOnboardingPort`
  介面）與 `TOKENS.GuildOnboardingPort`；抽出 `host/lifecycle.ts` 的
  `PluginLifecycleRunner`（經窄介面 `LifecycleHost` 注入）；`cascadeDisable`
  移入 `host/topology.ts` 成為純函式；`host.ts` 生命週期方法改為薄委派。
- **影響**：行為等價——生命週期執行語意不變，僅結構重組。

## 2026-05-21 — 補上 auto-merge reconciliation 規則

- **元件**：C10 Quality Gates / 工程團隊
- **缺口**：—
- **變更**：明確規範 auto-merge 非 fire-and-forget——check 失敗時 PR 會停在
  OPEN。`engineering-orchestrator` agent 新增「Auto-merge reconciliation」段落
  （追蹤待結 PR、依賴工作以 `MERGED` 為前置條件、失敗則 push 修正至同分支）；
  `CONTRIBUTING.md` 補上失敗 PR 的處理說明。
- **影響**：行為等價（無 `src/` 變更）。修正先前「派完 PR 即不理會」的不完整
  描述。

## 2026-05-21 — 啟用 auto-merge 為預設合併方式

- **元件**：C10 Quality Gates
- **缺口**：—
- **變更**：repo 啟用 GitHub auto-merge；定 `gh pr merge --auto --merge` 為
  預設合併方式。`CONTRIBUTING.md`、`docs/design/C10-quality-gates.md` §2.8、
  `engineering-orchestrator` agent 一併記載。
- **影響**：行為等價（無 `src/` 變更）。PR 排入 auto-merge 後，10 個 required
  check 全綠即由 GitHub 自動合併；auto-merge 不繞過 branch protection。

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
