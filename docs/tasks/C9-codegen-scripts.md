# C9 — Codegen & Scripts 工程任務

| 欄位     | 內容                                                                   |
| -------- | ---------------------------------------------------------------------- |
| 元件     | C9 Codegen & Scripts                                                   |
| 路徑     | `scripts/`                                                             |
| 設計檔   | [`docs/design/C9-codegen-scripts.md`](../design/C9-codegen-scripts.md) |
| 涉及缺口 | D4（條件性承接點評估）                                                 |

---

## 說明

C9 設計檔 §7 判定「無偏差」，`gen-registry.ts` 與 `smoke.ts` 與目標設計一致。
唯一與 C9 相關的任務，是 D4（`src/utils/` 收斂）盤點後，`bot_cmd.ts` 可能的承接
位置評估——gaps.md D4 步驟 3 指出 `bot_cmd.ts`（含 `buildCommandJsonBody`）
應評估移入 C6 handlers 或 C9 `scripts/`。

---

## D4 — `bot_cmd.ts` 候選承接點評估（P2）

> 主責缺口在 [C8 — Plugins](C8-plugins.md) D4。此任務依賴 C8 D4 步驟 1
> （callsite 盤點）先完成。

- [ ] 待 C8 完成 D4 callsite 盤點後，評估 `src/utils/bot_cmd.ts`（含
      `buildCommandJsonBody`）的職責歸屬——若屬 build-期 command JSON 組裝則
      `scripts/`，若屬 runtime handler 邏輯則 C6 handlers
- [ ] 依評估結論遷入 `scripts/` 或交還 C6，更新所有 import
- [ ] 若遷入 `scripts/`：維持 §1 邊界規則（`scripts/` 不參與 runtime）

**驗收**：`bot_cmd.ts` 承接位置經評估裁定並遷出；`src/utils/` 不再持有此檔。

---

## 交叉引用

- D4 主責與 callsite 盤點：[C8 — Plugins](C8-plugins.md)
- `JobManager` 的平行承接評估：[C1 — Core Infrastructure](C1-core-infrastructure.md)
