# C7 — i18n Catalog

> 路徑：`src/i18n/locales/` ｜詳細設計：[`docs/design/C7-i18n-catalog.md`](../../design/C7-i18n-catalog.md) ｜任務：[`docs/tasks/C7-i18n-catalog.md`](../../tasks/C7-i18n-catalog.md)

## 職責

純資料元件：存放 `<lang>/{commands,errors,replies}.json` user-facing 文案目錄。無程式邏輯，由 C1 的 `I18NextTranslator` 經 `catalog-loader` 載入。

## 現況

雙語系 catalog 已落地——`zh-TW/` 與 `en/` 各有 `commands.json`、`errors.json`、`replies.json` 三個命名空間檔，key 集合與 `{{placeholder}}` 集合跨語系對齊。

- `commands.json`：每個指令的 `description`、選項 `options.<opt>.description`、以穩定 `value` 為 key 的 `choices`；context menu 指令補 `name`。
- `errors.json`：對應 `DomainError.messageKey` 的使用者文案（`command` / `validation` / `permission` / `ai` / `db` / `llm` / `configuration` 群組加扁平 `unexpected`）。
- `replies.json`：所有其他指令回覆文案；每個指令 feature 含有語氣的 `<feature>.failed` 回退文案，並一律帶 `{{traceId}}` 內插位。
- catalog-completeness 測試（`yarn test:i18n`）以雙語系比對 key/placeholder；`test/i18n/catalog-runtime.test.ts` 以實際 `loadCatalogResources` + `I18NextTranslator` 管線驗證 en 解析、零缺 key、缺 key 回退。

## 近期變更

- 2026-05-24 — R5：`LoadCatalogOptions.localesDir` 由 optional 收為必填、移除 `DEFAULT_LOCALES_DIR` 常數；`createDefaultTranslator` 同步要求注入路徑。`core/i18n` 不再以 `__dirname` 反向解析下游內容層位置；路徑知識由合成根（新檔 `src/bot/locales-dir.ts`）擁有並透過 BaseBot ctor 注入。`src/deploy.ts` 與 `test/i18n/catalog-runtime.test.ts` 顯式傳入 `localesDir`（tech-debt R5）。
- 2026-05-21 — D7：填 `zh-TW/commands.json` 指令 metadata key，新建 `en/` 三個命名空間檔並英譯全部 key；新增 `test/i18n/catalog-runtime.test.ts` 覆蓋雙語系 parity 與 fallback（gap D7）。
- 2026-05-21 — D9：每個指令 feature 補有語氣的 `replies:<feature>.failed` 回退文案並帶 `{{traceId}}`，`en/` 同步英譯；C7 設計檔與 `CONTRIBUTING.md` 明示雙語系維護負擔（gap D9）。
- 2026-05-21 — 建立元件 wiki 頁（工程基礎建設）。
