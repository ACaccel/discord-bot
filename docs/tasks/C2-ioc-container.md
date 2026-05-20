# C2 — IoC Container 工程任務

| 欄位     | 內容                                                               |
| -------- | ------------------------------------------------------------------ |
| 元件     | C2 IoC Container                                                   |
| 路徑     | `src/core/ioc/`                                                    |
| 設計檔   | [`docs/design/C2-ioc-container.md`](../design/C2-ioc-container.md) |
| 涉及缺口 | 無                                                                 |

---

## 說明

C2 設計檔 §7 判定「無偏差」。HLD §5 C2 的「raw container 不對 plugin 暴露、
runtime hook 內禁 Service Locator」已由 ESLint `no-restricted-imports` 規則與
`Resolver` 介面分離雙重落實，與目標設計一致。

`docs/design/gaps.md` 的 D1–D9、G-1 均不涉及 C2。本元件**無收斂任務**。

---

## 待辦

- [x] 無待辦收斂任務（佔位，使 `progress.md` 完成度可勾選）

---

## 注意事項（非任務）

- D1 的 guild-onboarding port 會新增一個 `ServiceToken`，須登錄於 `TOKENS` 表。
  該 token 的新增屬 [C3 — Plugin Runtime](C3-plugin-runtime.md) D1 的工作範圍；
  C2 僅作為 token 定義所在地被動更新，不單列為 C2 任務。
