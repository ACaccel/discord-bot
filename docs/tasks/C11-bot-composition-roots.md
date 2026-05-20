# C11 — Bot Composition Roots 工程任務

| 欄位     | 內容                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 元件     | C11 Bot Composition Roots                                                                                                             |
| 路徑     | `src/bot/`                                                                                                                            |
| 設計檔   | [`docs/design/C11-bot-composition-roots.md`](../design/C11-bot-composition-roots.md)                                                  |
| 涉及缺口 | D1（`BaseBot` 提供 port 實作）、D2（`nijika` 改用 earthquake plugin）、D4（`@utils` alias / CLAUDE.md）、D5（`BaseBot` 退化為查詢端） |

---

## D1 — `BaseBot` 提供 guild-onboarding port 實作（P1）

> port 介面定義見 [C3](C3-plugin-runtime.md) D1，`guild-events` plugin 消費見
> [C8](C8-plugins.md) D1。此任務依賴 C3 D1 介面就緒。

- [ ] `BaseBot` 將 `connectOneGuild` 與 command 註冊邏輯收斂為 guild-onboarding
      port 的實作
- [ ] 把 port 實作經容器註冊為 `TOKENS` 之一（供 plugin `ctx.resolve` 取得）
- [ ] 補拓撲 / 生命週期測試，覆蓋經 port 的 `guildCreate` 初始化路徑

**驗收**：`BaseBot` 提供 port 實作；`guildCreate` 初始化不再依賴穿透
`BaseBot` 內部結構。

---

## D2 — `nijika` 改以 earthquake plugin 組裝（P1）

> `earthquake` plugin 實作見 [C8](C8-plugins.md) D2。此任務依賴 C8 D2 plugin 就緒。

- [ ] `nijika` 改以 `this.use(createEarthquakePlugin(...))` 組裝
- [ ] 移除 `src/bot/nijika/index.ts` 的 inline `app.listen()` 與
      `r.post('/discord/earthquake', ...)` 路由

**驗收**：`nijika/index.ts` 無 inline 地震路由；地震速報經 earthquake plugin
的 `start` hook 提供。

---

## D4 — 移除 `@utils` alias 與更新 CLAUDE.md（P2）

> `src/utils/` 收斂主責見 [C8](C8-plugins.md) D4。此任務依賴 C8 D4 — `src/utils/`
> 須先清空並刪除。

- [ ] 刪除 `tsconfig.json` 的 `@utils` path alias
- [ ] 更新 `CLAUDE.md` 目錄說明：移除過時的「`utils/` 僅 `logger.ts` strict」
      敘述，使與現況一致

**驗收**：`@utils` alias 不存在；CLAUDE.md 目錄說明與現況一致。

---

## D5 — `BaseBot` 退化為 disabled-guild 查詢端（P1）

> `ConnectionManager` 的 retry / `isDisabled` 主責見 [C5](C5-infra-adapters.md) D5。
> 此任務依賴 C5 D5 的 `isDisabled(guildId)` 介面就緒。

- [ ] `BaseBot.connectGuildDB` 移除自有的 `disabledGuilds` map 與 boot 時
      catch-記錄邏輯
- [ ] 改查 `ConnectionManager.isDisabled(...)` 作為 disabled 狀態來源
- [ ] 確認 `BaseBot` 不再自持 `disabledGuilds`；C6 `requireGuildRepos` 改讀的
      來源（見 C6 D5）一致

**驗收**：`BaseBot` 不再自持 `disabledGuilds`；disabled 狀態統一由
`ConnectionManager` 提供。

---

## 交叉引用

- D1 port 介面：[C3 — Plugin Runtime](C3-plugin-runtime.md)；plugin 消費：[C8](C8-plugins.md)
- D2 `earthquake` plugin 實作：[C8 — Plugins](C8-plugins.md)
- D4 `src/utils/` 收斂主責：[C8 — Plugins](C8-plugins.md)
- D5 `ConnectionManager` retry / `isDisabled`：[C5 — Infra Adapters](C5-infra-adapters.md)；`requireGuildRepos`：[C6](C6-handlers.md)
