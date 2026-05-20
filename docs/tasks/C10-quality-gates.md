# C10 — Quality Gates 工程任務

| 欄位     | 內容                                                                                       |
| -------- | ------------------------------------------------------------------------------------------ |
| 元件     | C10 Quality Gates                                                                          |
| 路徑     | CI workflow + `tsconfig*.json` / `eslint.config.mjs` / `vitest.config.ts` / `package.json` |
| 設計檔   | [`docs/design/C10-quality-gates.md`](../design/C10-quality-gates.md)                       |
| 涉及缺口 | D3（CJK scanner 範圍更新）、D8（strict tsconfig 涵蓋全 `src`）                             |

---

## D3 — CJK scanner `SCOPED_DIRECTORIES` 範圍更新（P1，依賴 C8 D3）

> 此任務依賴 [C8](C8-plugins.md) D3 — `src/events/` 目錄須先實際刪除。在 D3
> 完成前，scanner 納入 `src/events` 是正確的（過渡層仍在就該掃）。

- [ ] 待 `src/events/` 刪除後，從 `test/i18n/no-literal-cjk.test.ts` 的
      `SCOPED_DIRECTORIES` 移除 `src/events`
- [ ] 確認 CJK scanner 仍對 `src/handlers`、`src/plugins`、`src/bot` 三目錄
      strict-mode 掃描且 CI 綠

**驗收**：`SCOPED_DIRECTORIES` 與現存目錄一致；scanner 為 CI gate。

---

## D8 — strict tsconfig 涵蓋全 `src`（P1）

- [x] 逐步把 `src/infra/discord/**`、`src/plugins/**`、`src/handlers/**`、
      `src/bot/**` 加入 `tsconfig.strict.json` 的 `include`
- [x] 每納入一個子樹，掃除 `any` escape，改 `unknown` + narrowing；intentional
      處加註記
- [x] `yarn typecheck` 確認全綠

**驗收**：`tsconfig.strict.json` 的 `include` 涵蓋全 `src`；`any` / `as any`
降至個位數（intentional 處加註記）。

---

## 交叉引用

- D3 `src/events/` 目錄刪除：[C8 — Plugins](C8-plugins.md)
