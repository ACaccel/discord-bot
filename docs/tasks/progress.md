# 進度總覽 — Tech-Debt Cleanup

> 一個 R 全部子任務完成且 quality gates 綠後才打勾。子任務勾選狀態維護在各自的 R\<N\>.md。

依賴順序：**R1 → R2 → R3 → R4 → R5 → R6**

| 狀態  | R   | 主題                                 | 詳細任務       |
| ----- | --- | ------------------------------------ | -------------- |
| `[x]` | R1  | 拆解 BaseBot 為 thin lifecycle owner | [R1.md](R1.md) |
| `[x]` | R2  | 消除 DI 旁路                         | [R2.md](R2.md) |
| `[x]` | R3  | plugins ↔ core/ioc 契約對齊          | [R3.md](R3.md) |
| `[x]` | R4  | 過長 handler 拆分 + 行數規範         | [R4.md](R4.md) |
| `[ ]` | R5  | i18n catalog 路徑反耦合              | [R5.md](R5.md) |
| `[ ]` | R6  | 5 個低優先單點清理                   | [R6.md](R6.md) |

---

## 各 R 的退場 acceptance 抹重點

每個 R 的「全部子任務完成」之外，還需通過下列關鍵驗收才能在上表打勾。完整 acceptance 見對應 [docs/design/R\*.md](../design/) 的測試章節與 [proposal §10.4](../proposal.md#104-退場條件)。

### R1 — 拆解 BaseBot

- `src/bot/index.ts` 與「Thin lifecycle owner」描述相符（≤ ~400 行為參考）。
- `GuildRegistrar` / `ClientEventBridge` / `GuildDbConnector` 各自有獨立 spec 並通過。
- 拆解前補的 contract / integration 測試全部留下且通過。
- `architecture-reviewer` Audit → PASS（無新增分層違規）。

### R2 — DI 旁路消除

- `grep -rn 'let active' src/plugins src/infra` 結果為空。
- `bot.voice` / `models-catalog` 解析路徑能由「BaseBot resolve → plugin init 註冊」單條 trace 串起。
- `ctx.registerInstance` 在非 `init` hook 呼叫的拒絕行為有單元測試覆蓋。

### R3 — plugins ↔ core/ioc 契約對齊

- `grep -rln "from '.*core/ioc'" src/plugins` 結果為空。
- ESLint `no-restricted-imports` 對 `src/plugins/**` 違規時 fail。
- CLAUDE.md / CONTRIBUTING.md / 兩份 SKILL.md 規範文字 verbatim 一致。

### R4 — handler 拆分 + 規範

- 4 個示範 handler 的 `index.ts` 全部 ≤ 150 行；helper 各有單元測試。
- 既有 handler 測試全綠（行為位元等價）。
- ESLint `max-lines` 在所有非 `registry.generated.ts` 的 `src/handlers/**/*.ts` 皆通過（或在 ignores 中明列豁免並有 PR follow-up）。
- 規範文字 verbatim 在 4 份文件一致。

### R5 — i18n catalog 路徑反耦合

- `grep -n "'i18n'" src/core` 結果為空。
- `LoadCatalogOptions.localesDir` 為必填（型別層強制）。
- 既有 catalog-completeness / 既有 i18n 測試全綠；新增 catalog-load smoke 測試通過。

### R6 — 低優先清理

- **R6.1**：traceId 來源為 `crypto.randomUUID()`。
- **R6.2**：`BaseBot.run()` 在 login 失敗時 promise reject 而非吞掉；對應整合測試覆蓋。
- **R6.3**：`grep -rn 'console\.' src --include='*.ts'` 結果為空或僅剩刻意允許的 last-resort（並有對應 ESLint allowlist）。
- **R6.4**：所有 Handler Map / 命名一致（複數 / camelCase）；handler / subclass / test 端同步修正。
- **R6.5**：`src/bot/index.ts` import 區連續無夾雜；ESLint `import/first` 全綠。

---

## 全域退場條件

當上表所有 R 全部打勾後，再執行一次：

```bash
yarn typecheck && yarn lint && yarn test && yarn format:check && yarn handlers:gen:check && yarn knip && yarn security
```

全綠後即可從 `refactor/tech-debt-cleanup` 發 PR 合入 `refactor/architecture-overhaul`。
