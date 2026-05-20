# Gap-Remediation Engineering — Start Here

> 新 session 從這裡開始。本檔是這項工程的單一進入點。

## 1. 這是什麼工程

`docs/proposal.md` §6 宣稱重構所有需求（REQ-A1~G7）已落地，但
`docs/design/` 的詳細設計逐元件比對現況後，發現 **10 項目標設計未落地缺口**
（D1–D9、G-1），記錄於 [`docs/design/gaps.md`](../design/gaps.md)；任務劃分時
另裁定新增 **G-2**（repository 邊界 `Result` 一致性）。

本工程的目標：把這 11 項缺口收斂完成，使 codebase 與目標設計一致、所有品質
閘門全綠。

## 2. 目前進度

**進度單一事實來源**：[`progress.md`](progress.md)。

截至 2026-05-21：

- 缺口任務已劃分完成 — `docs/tasks/` 下 11 個元件任務檔（`C1`~`C11`）+
  `progress.md`，每個缺口切分為 check list 子任務。
- 工程 agent 團隊與 skills 已建立完成（見 §4）。
- **實作工程尚未開始** — `progress.md` §2 的 11 個元件完成度全部未勾選。

## 3. 如何接手繼續

實作工程設計為**全自主、無人工參與**。接手方式：

> 在主對話下達指令，spawn `engineering-orchestrator` agent（建議
> `run_in_background: true`），要求它把 `docs/tasks/` 的缺口收斂工程做到完工。

orchestrator 會：讀 `progress.md` → 依 §4 依賴波次派發 `component-implementer`
子 agent → 監控、失敗重試 → 回寫 `progress.md` → 跑最終全品質閘門，直到所有
元件完成且所有測試通過。

若想手動推進個別元件，直接 spawn `component-implementer` 並指定元件與缺口；
它會遵循 `gap-task-workflow` skill。

## 4. 工程團隊與 skills

### Agents（`.claude/agents/`）

| Agent                          | 角色                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `engineering-orchestrator`     | 主控 — 自主驅動整個工程、派發子 agent、監控、跑最終閘門                         |
| `component-implementer`        | 工程實作 — 領單一元件，實作程式+測試、自檢、consult reviewer、跑閘門、更新 wiki |
| `architecture-reviewer`        | 分層 / design pattern 審查                                                      |
| `type-system-reviewer`         | TypeScript 型別系統審查                                                         |
| `reliability-reviewer`         | 錯誤處理 / 韌性 / 生命週期審查                                                  |
| `test-architect`               | 測試策略 / 覆蓋率審查                                                           |
| `config-and-security-reviewer` | CI / build / 安全審查                                                           |
| `i18n-discipline-reviewer`     | i18n catalog / CJK literal 審查                                                 |

### Skills（`.claude/skills/`）

| Skill                 | 用途                                                                           |
| --------------------- | ------------------------------------------------------------------------------ |
| `project-conventions` | 專案架構框架規定（分層、Plugin、IoC、Repository、錯誤樹、i18n…）+ 自我檢測清單 |
| `coding-standards`    | 通用程式碼品質規範 + 自我檢測清單                                              |
| `gap-task-workflow`   | 實作一個元件的標準流程 + 五項 Definition of Done + 品質閘門指令                |
| `update-wiki`         | 任何新增 / 刪除 / 修改後自動同步 `docs/wiki/`                                  |

## 5. 文件地圖

| 文件                        | 內容                                     |
| --------------------------- | ---------------------------------------- |
| `docs/proposal.md`          | 需求規格（RFC，REQ-A1~G7）               |
| `docs/high-level-design.md` | 概要設計（11 個元件 C1–C11 的切分）      |
| `docs/design.md`            | 詳細設計索引                             |
| `docs/design/C<N>-*.md`     | 各元件詳細設計（含 §7「與 HLD 的偏差」） |
| `docs/design/gaps.md`       | 缺口 backlog（D1–D9、G-1）+ 決議紀錄     |
| `docs/tasks/C<N>-*.md`      | 各元件的缺口收斂子任務 check list        |
| `docs/tasks/progress.md`    | 進度、缺口↔元件對照、§4 任務依賴順序     |
| `docs/wiki/`                | repo wiki（活文件，隨變更自動同步）      |

## 6. 關鍵決策與注意事項

- **所有缺口的修正方向皆已裁定**，可直接開工。決議見 `gaps.md` §4 與各任務檔。
- **G-2 採方案 Y**：七個 repository 邊界改回 `Result<T, DatabaseError>`，
  mongoose error-translator 移入 `persistence/`。詳見
  [`C4-persistence.md`](C4-persistence.md)。
- **依賴順序**：D3 依賴 D1+D2；C4 G-2 須早於 C5 D5（共用 error-translator）；
  完整順序見 `progress.md` §4——orchestrator 須遵守。
- **完工硬條件**：所有品質閘門全綠（`progress.md` 與 `gap-task-workflow` §6 的
  指令清單）。`yarn smoke` 需真實 Discord token，環境無 env 時記錄略過、其餘
  閘門照常強制全綠。
- **行為等價**：重構不得改動四個 bot 的對外行為（proposal §3.2 非目標）。
- 目前 `docs/`、`.claude/skills/`、新 agent 檔尚未 commit；檔案在磁碟上，新
  session 可直接讀取。是否 commit 由使用者決定。
