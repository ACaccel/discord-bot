# C3 — Plugin Runtime 工程任務

| 欄位     | 內容                                                                 |
| -------- | -------------------------------------------------------------------- |
| 元件     | C3 Plugin Runtime                                                    |
| 路徑     | `src/core/plugin/`（含 `host/`）                                     |
| 設計檔   | [`docs/design/C3-plugin-runtime.md`](../design/C3-plugin-runtime.md) |
| 涉及缺口 | D1（guild-onboarding port 介面）、D6（`host/lifecycle.ts`）          |

---

## D1 — guild-onboarding port 介面（P1）

> 跨元件缺口。本節僅負責**介面定義**；`BaseBot` 實作見
> [C11](C11-bot-composition-roots.md) D1，`guild-events` plugin 消費見
> [C8](C8-plugins.md) D1。

- [ ] 在 `src/core/plugin/types.ts`（或新檔）定義 typed guild-onboarding port
      介面，封裝「連線新 guild 的 DB」與「註冊該 guild 的 command」兩項能力
- [ ] 為該 port 在 `src/core/ioc/tokens.ts` 新增對應 `ServiceToken`，登錄 `TOKENS` 表
- [ ] 確認 port 介面不使 C3 相依 `persistence` / `infra`（維持 §1 邊界規則）
- [ ] 補 port 介面的型別 / 契約測試

**驗收**：`guildCreate` 路徑不再穿透 `BaseBot` 內部結構所需的 typed 介面就緒；
plugin 可經 `ctx.resolve` 取得此 port。

---

## D6 — 抽出 `host/lifecycle.ts`（P2，DECIDED 方案 A + 窄介面）

- [ ] 定義窄介面 `LifecycleHost`（或 `LifecycleContext`），僅暴露 lifecycle 真正
      需要的 host 狀態切片：registered plugins map、`order` 陣列、`disabled` map
      （可讀寫）、dependents 索引、resolver、`EventDispatcher`、`logger` /
      `translator` / `clock`
- [ ] 在 `host/lifecycle.ts` 實作 `PluginLifecycleRunner` 類別，建構時注入
      `LifecycleHost`，對外提供 `runInit()` / `runStart()` / `runReady()` /
      `runShutdown()`
- [ ] 把 `cascadeDisable` 抽成純函式，置於 `host/topology.ts`（作為既有
      `buildDependentsIndex` 的搭檔）
- [ ] `host.ts` 的 `initAll` / `startAll` / `readyAll` / `shutdownAll` 改為對
      `PluginLifecycleRunner` 的薄委派，`host.ts` 回歸「wiring + 公開 API」職責
- [ ] 補測試：以 fake `LifecycleHost` 建構 `PluginLifecycleRunner`，單元測試各
      phase、cascade-disable、critical-escalation
- [ ] 確認既有 host 測試維持綠

**驗收**：`host/lifecycle.ts` 存在且 `PluginLifecycleRunner` 經窄介面注入；
`host.ts` 行數顯著下降；`cascadeDisable` 為純函式且有單元測試；既有測試全綠。

---

## 交叉引用

- D1 `BaseBot` port 實作：[C11 — Bot Composition Roots](C11-bot-composition-roots.md)
- D1 `guild-events` plugin 消費 port：[C8 — Plugins](C8-plugins.md)
- D1 新增 `ServiceToken` 登錄處：[C2 — IoC Container](C2-ioc-container.md)
