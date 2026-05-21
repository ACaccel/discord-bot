# C6 — Handlers 工程任務

| 欄位     | 內容                                                                                         |
| -------- | -------------------------------------------------------------------------------------------- |
| 元件     | C6 Handlers                                                                                  |
| 路徑     | `src/handlers/`                                                                              |
| 設計檔   | [`docs/design/C6-handlers.md`](../design/C6-handlers.md)                                     |
| 涉及缺口 | D5（`requireGuildRepos` 改讀來源）、D7（指令 metadata 去 CJK literal）、D9（依錯誤型別回覆） |

---

## D5 — `requireGuildRepos` 改讀 `ConnectionManager`（P1）

> 主責缺口在 [C5](C5-infra-adapters.md) D5；本節僅負責 handler 端的讀取來源切換。
> 此任務依賴 C5 D5 的 `isDisabled(guildId)` 介面就緒。

- [x] `requireGuildRepos` 的 disabled-guild 守衛（第 2 道）改讀
      `ConnectionManager.isDisabled(...)`，不再讀 `bot.disabledGuilds`
- [x] 確認回 `errors:db.guild_disabled` 時附帶的 `traceId` 取自
      `ConnectionManager` 且與結構化 log 一致

**驗收**：handler 不再依賴 `BaseBot.disabledGuilds`；disabled-guild 訊息收斂至
單一修改點。

---

## D7 — 指令 metadata 去 CJK literal（P2，DECIDED 方案 A）

> catalog 端（填 `commands.json`、新建 `en/`）見 [C7](C7-i18n-catalog.md) D7。
> 此任務依賴 C7 D7 的 `commands` catalog key 就緒。

- [x] handler 指令名稱 / 選項描述改以 `commands` 命名空間 catalog key 取代
      handler 內的 CJK literal
- [x] 移除 `src/handlers/` 內豁免指令 metadata 的 `// i18n-ignore` 註記

**驗收**：`src/handlers/` 無 `// i18n-ignore` 於指令 metadata；CJK scanner 對
`src/handlers` 零違規。

---

## D9 — handler 依錯誤型別回覆（P2，DECIDED 方案 B）

> 文案語氣（`errors.json` / `replies.json`）見 [C7](C7-i18n-catalog.md) D9。

- [x] 設計 handler 邊界共用 helper
      `replyForError(interaction, translator, error, fallbackKey)`：
  - `error instanceof DomainError` → `translator.t(error.messageKey, error.messageParams)`
  - 否則 → `translator.t(fallbackKey, { traceId })`
- [x] 各 handler catch 改為「`logError(...)`（operator 通道）+
      `replyForError(..., 'replies:<feature>.failed')`（user 通道）」
- [x] 保留各指令既有的 `replies:<feature>.failed` 語氣文案，作為非 `DomainError`
      回退用
- [x] 補 handler 邊界錯誤對應測試：分別注入 `DomainError` 與 raw error，驗證
      operator 通道（永遠記完整結構化 log）與 user 通道（DomainError → messageKey；
      非 DomainError → per-feature fallback + traceId）兩條輸出

**驗收**：handler 對 `DomainError` 依 `messageKey` 回覆、對非 `DomainError` 回退
per-feature 語氣文案並附 `traceId`；operator log 兩種情況均含完整錯誤。

---

## 交叉引用

- D5 `ConnectionManager` retry / `isDisabled`：[C5 — Infra Adapters](C5-infra-adapters.md)
- D7 `commands.json` 填充與 `en/` catalog：[C7 — i18n Catalog](C7-i18n-catalog.md)
- D9 `errors.json` / `replies.json` 文案語氣與英譯：[C7 — i18n Catalog](C7-i18n-catalog.md)
