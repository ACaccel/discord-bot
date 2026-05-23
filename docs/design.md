# 詳細設計文件（索引）— Tech-Debt Cleanup (R1–R6)

| 欄位     | 內容                                                                                       |
| -------- | ------------------------------------------------------------------------------------------ |
| 對應需求 | [docs/proposal.md](proposal.md)                                                            |
| 對應概要 | [docs/high-level-design.md](high-level-design.md)                                          |
| 文件層級 | Per-R 詳細設計——含 TypeScript 介面骨架、class 骨架、採用 design pattern + 理由、測試驗收點 |
| 組織方式 | 本檔為索引；每個 R 一份獨立詳細設計文件，可獨立 review / 實作 / 測試                       |

---

## 1. 詳細設計目錄

| R   | 主題                                                            | 詳細設計文件                      |
| --- | --------------------------------------------------------------- | --------------------------------- |
| R1  | 拆解 BaseBot 為 thin lifecycle owner（3 個 collaborator）       | [docs/design/R1.md](design/R1.md) |
| R2  | 消除 DI 旁路（PluginContext.registerInstance）                  | [docs/design/R2.md](design/R2.md) |
| R3  | plugins ↔ core/ioc 契約對齊（core/plugin barrel 唯一窗口）      | [docs/design/R3.md](design/R3.md) |
| R4  | 過長 handler 拆分 + 行數規範 + ESLint enforce                   | [docs/design/R4.md](design/R4.md) |
| R5  | i18n catalog 路徑反耦合（`localesDir` 改必填）                  | [docs/design/R5.md](design/R5.md) |
| R6  | 5 個低優先單點清理（traceId / login / console / 命名 / import） | [docs/design/R6.md](design/R6.md) |

---

## 2. 共通設計原則

所有 R 詳細設計文件遵守下列共通契約，不在各文件重述：

### 2.1 模組獨立性

- 每個新類別 / 每個改寫單元都應能**獨立進行單元測試**——不依賴 Discord client 即時實體、不依賴實際 Mongo 連線、不依賴實體檔案系統（除非該類別的職責本身就是 I/O）。
- 對外副作用（網路、I/O、時間、隨機）一律由 constructor 注入抽象 seam（`Clock`、`Logger`、`ServiceContainer`、`Translator` 等）。
- 「獨立可測」是設計階段就要回答的問題；任何類別若無法寫出單元測試案例，視為設計缺陷。

### 2.2 採用的 design pattern 速查

| Pattern                     | 採用場景                                                                              | 出現的 R   |
| --------------------------- | ------------------------------------------------------------------------------------- | ---------- |
| Composition                 | BaseBot 由 collaborator 組成（GuildRegistrar / ClientEventBridge / GuildDbConnector） | R1         |
| Facade                      | `ctx.registerInstance` 是 ServiceContainer 寫入面的窄面 facade                        | R2         |
| Adapter                     | `ClientEventBridge` 把 Discord raw event 轉成 domain event                            | R1         |
| Strategy（既有沿用）        | 既有 InteractionRouter middleware chain、LLMProvider                                  | R1（沿用） |
| Repository（既有沿用）      | Persistence 層                                                                        | R1（沿用） |
| Result / Either（既有沿用） | 錯誤路徑                                                                              | R1 / R6.2  |
| Module barrel               | `core/plugin/index.ts` 為 plugin 對 IoC 的唯一公開窗口                                | R3         |
| Guard clause                | `PluginContext.registerInstance` 的時機檢查                                           | R2         |

詳細採用理由與替代方案比較寫在各 R 文件的「Pattern 採用」章節。

### 2.3 命名與型別約定

- 公開類別 / 介面：PascalCase。
- 模組私有 helper：camelCase。
- 集合命名一律用複數（R6.4 在 R1 commit 內同步落地）。
- Result 用 `Result<T, E extends DomainError>`；error 型別以 `core/errors/` 既有 taxonomy 為準。
- 任何 token 都在 `src/core/ioc/tokens.ts` 集中宣告；新增 token 一律走 `core/plugin` re-export 對 plugin 暴露（R3）。

### 2.4 測試章節結構

每份 R 文件的「測試設計」章節都按下列結構：

1. **測試驗收點**：以類別為單位列出必要案例（happy path、邊界、error path）。
2. **Fixture / Mock 策略**：哪些依賴用 fake，哪些用 mock，哪些走真實實作。
3. **整合面**：跨類別 / 跨 R 的整合測試在哪個 spec 集中驗證。

不在共通章節重述，但所有 R 文件遵守同一結構。

### 2.5 文件級別的「不做」

下列議題在所有 R 詳細設計中皆**不展開**（在各 R 的「不做的設計決策」章節重申其與該 R 的相關性）：

- 不替換 IoC 框架。
- 不引入 `reflect-metadata`。
- 不為了 R 而引入新的 Design Pattern（如 Mediator、CQRS）。
- 不修改既有 Plugin / handler 的 i18n key、catalog 結構、Discord 指令簽名。

---

## 3. 文件互讀順序建議

對於本輪實作工程師：

1. 先讀 [proposal.md](proposal.md)（為什麼做）
2. 再讀 [high-level-design.md](high-level-design.md)（架構演變總覽）
3. 依 R1 → R2 → R3 → R4 → R5 → R6 順序讀對應 design/R\*.md（實作前直接照詳細設計做）
4. 每完成一個 R，回到 proposal §10.4 退場條件檢查清單對齊

對於 reviewer：

- 程式碼層級評審以對應 R 的 design 文件為對照。
- 跨 R 的整合議題以本索引 §2 的共通設計原則為對照。
