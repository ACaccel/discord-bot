# Tech-Debt Cleanup — 任務入口

| 欄位     | 內容                                                    |
| -------- | ------------------------------------------------------- |
| 工程     | 收斂 architecture-overhaul 完成後的剩餘技術債（R1–R6）  |
| 分支     | `refactor/tech-debt-cleanup`                            |
| 合併目標 | 全部完成後，一次 PR 到 `refactor/architecture-overhaul` |
| 入口     | 本檔                                                    |

---

## 文件鏈

- [docs/proposal.md](../proposal.md) — 需求規格（為何做、要達成什麼、什麼不做）
- [docs/high-level-design.md](../high-level-design.md) — 概要設計（架構演變 + 各 R 之間關係）
- [docs/design.md](../design.md) — 詳細設計索引；per-R 細部設計在 [docs/design/R\*.md](../design/)
- [progress.md](progress.md) — 進度總覽（以 R 為單位的 checklist）
- [R1.md](R1.md) ‥ [R6.md](R6.md) — 每個 R 的子任務 checklist

---

## 工作流程

1. 從 [progress.md](progress.md) 看下一個未完成的 R。
2. 打開對應的 `R<N>.md`，照子任務 checklist 逐項實作。
3. 每完成一個子任務，把該項 `- [ ]` 改成 `- [x]`。
4. 一個 R 全部完成 → 在 progress.md 把該 R 打勾。
5. 跑該 R 的退場 quality gates（typecheck / lint / test / format / handlers:gen:check）。
6. 進入下一個 R。

依賴順序：**R1 → R2 → R3 → R4 → R5 → R6**。R1 是其他項的基礎，R6.4 / R6.5 須與 R1 同分支內同步落地（見 [proposal §3](../proposal.md#3-交付方式)）。

---

## 提交與 PR

- 每完成一個有意義的單元（單一 collaborator、單一 helper 抽出、單一 ESLint 規則 + 對應修正）就 commit；不要把整個 R 塞成一個 commit。
- Commit message 在 prefix 標 `refactor(R<N>): ...` 或 `fix(R6.<x>): ...`，方便日後查找。
- 全部 R 落地後，一次 PR 到 `refactor/architecture-overhaul`；PR description 引用 [progress.md](progress.md) 的勾選狀態作為自我審閱清單。
