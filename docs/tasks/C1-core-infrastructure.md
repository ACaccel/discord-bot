# C1 — Core Infrastructure 工程任務

| 欄位     | 內容                                                                           |
| -------- | ------------------------------------------------------------------------------ |
| 元件     | C1 Core Infrastructure                                                         |
| 路徑     | `src/core/`（不含 `ioc/`、`plugin/`）                                          |
| 設計檔   | [`docs/design/C1-core-infrastructure.md`](../design/C1-core-infrastructure.md) |
| 涉及缺口 | D4（條件性承接點評估）                                                         |

---

## 說明

C1 設計檔 §7 判定「無實質偏差」，本身無目標設計未落地處。唯一與 C1 相關的任務，
是 D4（`src/utils/` 收斂）盤點後，`JobManager` 可能的承接位置評估——`JobManager`
為 node-schedule 包裝，若無 Discord / Mongo 相依，`core/` 為其合理歸宿。

---

## D4 — `JobManager` 候選承接點評估（P2）

> 主責缺口在 [C8 — Plugins](C8-plugins.md) 的 D4；本節僅處理 `core/` 作為承接點
> 的評估與遷入。此任務依賴 C8 D4 步驟 1（callsite 盤點）先完成。

- [x] 待 C8 完成 D4 callsite 盤點後，確認 `src/utils/job_manager.ts` 的 `JobManager`
      是否無 Discord / Mongoose 相依 — 確認無相依，僅依賴 `node-schedule`
- [x] 若無相依：於 `src/core/` 新增承接子模組 `core/scheduling/` 並遷入
      `JobManager`（及 `misc.ts` 的 `parseDuration`），維持邊界規則
      「`core/` 不 import `src/` 其他上層模組」
- [x] 遷入後補 `JobManager` 單元測試，達 C10 對 `src/core/**` 的高覆蓋門檻
      （`core/scheduling/` 行 / 函式 / 敘述 / 分支覆蓋皆 100%）
- [x] 若評估為有相依：記錄結論，交還 C8 改置於 plugin `internal/`，本節標記不適用
      — 不適用（評估結論為無相依，落於 `core/`）

**驗收**：`JobManager` 承接位置經評估裁定；若落於 `core/` 則該子模組通過 core 覆蓋門檻。

---

## 交叉引用

- D4 主責與 callsite 盤點：[C8 — Plugins](C8-plugins.md)
- `bot_cmd.ts` 的平行承接評估：[C9 — Codegen & Scripts](C9-codegen-scripts.md)
- `@utils` alias 移除與 CLAUDE.md 更新：[C11 — Bot Composition Roots](C11-bot-composition-roots.md)
