# 工程任務進度總覽

| 欄位     | 內容                                                                        |
| -------- | --------------------------------------------------------------------------- |
| 文件類型 | 任務進度追蹤（Progress Tracker）                                            |
| 來源     | [`docs/design/gaps.md`](../design/gaps.md) — 目標設計未落地缺口 D1–D9 + G-1 |
| 任務範圍 | 僅 gaps.md 收斂工作；proposal §5 已落地之 REQ 不重列                        |
| 最後更新 | 2026-05-20                                                                  |

---

## 1. 說明

本目錄 `docs/tasks/` 為 11 個元件（C1–C11）各安排一個任務檔，子任務以 check list
表示完成與否。任務內容**僅涵蓋 `docs/design/gaps.md` 的收斂工作**（D1–D9、G-1）；
proposal §5 宣稱已落地的 REQ 不再列為任務。

橫跨多元件的缺口（D1、D2、D3、D4、D5）已**按元件切分子任務**，各元件任務檔只列
自身負責的切片，並以交叉引用指向協作元件。

一個元件視為「已完成」的條件：該元件任務檔內所有子任務 check 完成，且 gaps.md
對應項目的驗收標準通過。

---

## 2. 元件完成度

- [ ] [C1 — Core Infrastructure](C1-core-infrastructure.md) — D4 候選承接點評估（條件性）
- [x] [C2 — IoC Container](C2-ioc-container.md) — 無收斂任務
- [x] [C3 — Plugin Runtime](C3-plugin-runtime.md) — D1（介面）、D6 ✅
- [ ] [C4 — Persistence](C4-persistence.md) — G-2（repository 邊界 `Result` 一致性）
- [ ] [C5 — Infra Adapters](C5-infra-adapters.md) — D5
- [ ] [C6 — Handlers](C6-handlers.md) — D5、D7、D9
- [ ] [C7 — i18n Catalog](C7-i18n-catalog.md) — D7、D9
- [ ] [C8 — Plugins](C8-plugins.md) — D2 ✅、G-1 ✅；D1、D3、D4 待辦
- [ ] [C9 — Codegen & Scripts](C9-codegen-scripts.md) — D4 候選承接點評估（條件性）
- [ ] [C10 — Quality Gates](C10-quality-gates.md) — D8 ✅；D3 待辦（依賴 C8 D3）
- [ ] [C11 — Bot Composition Roots](C11-bot-composition-roots.md) — D1、D2、D4、D5

> C2、C4、C9 的設計檔 §7 判定「無實質偏差」。C2 無收斂任務（任務檔僅作存檔
> 說明）；C9 僅在 D4 盤點後可能承接 `bot_cmd.ts`，屬條件性任務。C4 經使用者
> 裁定，將設計檔記錄的「repository 邊界 `Result` 一致性」風格差異補列為 G-2。

---

## 3. 缺口 → 元件對照

| 缺口 | 標題                                              | 優先級 | 涉及元件                                              | 狀態                  |
| ---- | ------------------------------------------------- | ------ | ----------------------------------------------------- | --------------------- |
| D1   | guild-onboarding port 不存在                      | P1     | C3（介面）、C11（實作）、C8（消費）                   | OPEN                  |
| D2   | `earthquake` plugin 不存在                        | P1     | C8（plugin）、C11（組裝）                             | OPEN                  |
| D3   | `src/events/` 過渡層仍存在                        | P1     | C8（刪目錄/alias）、C10（scanner 範圍）               | OPEN（依賴 D1+D2）    |
| D4   | `src/utils/` 仍存在且被依賴                       | P2     | C8（收斂）、C11（alias/CLAUDE.md）、C1·C9（承接評估） | OPEN                  |
| D5   | `ConnectionManager` 無 retry / 降級分類           | P1     | C5（主）、C11（查詢端）、C6（requireGuildRepos）      | DECIDED 方案 A        |
| D6   | `host/` 無 `lifecycle.ts`                         | P2     | C3                                                    | DECIDED 方案 A+窄介面 |
| D7   | i18n 僅 `zh-TW`、`commands.json` 為空             | P2     | C7（catalog）、C6（handler 去 literal）               | DECIDED 方案 A        |
| D8   | strict tsconfig 未涵蓋 `src/bot`、`src/handlers`  | P1     | C10                                                   | OPEN                  |
| D9   | handler 不直接 catch `DomainError`                | P2     | C6（helper）、C7（文案語氣）                          | DECIDED 方案 B        |
| G-1  | giveaway/activity `msgReact` 用 `console.error`   | P3     | C8                                                    | OPEN                  |
| G-2  | repository 邊界 `Result` 一致性（任務劃分時新增） | P2     | C4（主）、C5（error-translator 落點協調）             | DECIDED 方案 Y        |

---

## 4. 任務依賴順序

下列順序為跨元件依賴，排程時須遵守：

1. **D3 依賴 D1 + D2**：`src/events/` 目錄須待 `guild_event.ts`（D1）與
   `earthquake.ts`（D2）吸收完成後才能刪除。
2. **C10 D3 依賴 C8 D3**：CJK scanner 的 `SCOPED_DIRECTORIES` 移除 `src/events`
   須待該目錄實際刪除後。
3. **C1 / C9 的 D4 承接評估依賴 C8 D4 步驟 1**：`JobManager` / `bot_cmd.ts` 的
   承接位置須待 callsite 盤點完成才能裁定。
4. **C6 / C11 的 D5 子任務依賴 C5 D5**：`requireGuildRepos` 與 `BaseBot` 改為
   查詢端，須待 `ConnectionManager.isDisabled(...)` 介面就緒。
5. **C6 D7 依賴 C7 D7**：handler 去 CJK literal 須待 `commands` catalog key 就緒。
6. **C4 G-2 與 C5 D5 共用 error-translator**：G-2 把 mongoose error-translator
   搬至 `persistence/`，D5 在同一檔新增 `isTransient` helper。兩項須協調落點，
   不得各自重建此檔——建議先完成 G-2 的搬遷，再由 D5 在新位置補 `isTransient`。

無跨元件依賴、可立即並行開工者：C3（D1 介面、D6）、C5（D5）、C7（D7、D9）、
C10（D8）、C8（D1 plugin 端、D2、G-1）。
