# C7 — i18n Catalog 工程任務

| 欄位     | 內容                                                                            |
| -------- | ------------------------------------------------------------------------------- |
| 元件     | C7 i18n Catalog                                                                 |
| 路徑     | `src/interface/locales/`                                                        |
| 設計檔   | [`docs/design/C7-i18n-catalog.md`](../design/C7-i18n-catalog.md)                |
| 涉及缺口 | D7（補完整 `en/` catalog + `commands.json`）、D9（`errors`/`replies` 文案語氣） |

---

## D7 — 補完整 `en/` catalog + `commands.json`（P2，DECIDED 方案 A）

> 裁定方案 A：補完整 `en/` 語系，不收斂 `Locale` union。handler 端去 CJK
> literal 見 [C6](C6-handlers.md) D7。

- [x] 填 `zh-TW/commands.json` 的指令名稱 / 描述 key（依 `README` 之 PR 6-3 規劃）
- [x] 新建 `src/interface/locales/en/{commands,errors,replies}.json`，把 `zh-TW`
      的全部 key 英譯（含 D9 新增 / 調整的 `errors:*` 與 `replies:<feature>.failed`）
- [x] 確認 catalog-completeness 測試（`yarn test:i18n`）以雙語系比對——任一語系
      缺 key 即 fail
- [x] 確認 `I18NextTranslator` 的 `fallbackLocale` 對缺漏 key 仍優雅回退至 `zh-TW`
- [x] 在 C7 設計文件與 `CONTRIBUTING.md` 明示維護負擔：每新增一個 catalog key
      須同步提供 `zh-TW` 與 `en` 兩份翻譯

**驗收**：`commands.json` 非空；`en/` 三個命名空間檔齊備；catalog-completeness
測試以雙語系運作並通過。

---

## D9 — `errors` / `replies` 文案語氣（P2，DECIDED 方案 B）

> handler 端 `replyForError` helper 見 [C6](C6-handlers.md) D9。

- [x] 確認 `errors.json` 內被 `DomainError.messageKey` 引用的文案皆以 bot 人格
      語氣撰寫（taxonomy-driven 不等於無語氣——語氣住在 catalog 文案裡）
- [x] 確認各指令保留有語氣的 `replies:<feature>.failed` 文案，作為非 `DomainError`
      錯誤的回退（須含 `{{traceId}}` 內插位）
- [x] D7 新建 `en/` 時，一併英譯上述 `errors:*` 與 `replies:<feature>.failed` 文案

**驗收**：`DomainError.messageKey` 目標文案有語氣；per-feature 回退文案含
`traceId` 內插；雙語系皆備齊。

---

## 交叉引用

- D7 handler 指令 metadata 去 CJK literal：[C6 — Handlers](C6-handlers.md)
- D9 handler `replyForError` helper：[C6 — Handlers](C6-handlers.md)
