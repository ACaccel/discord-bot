# C8 — Plugins 工程任務

| 欄位     | 內容                                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 元件     | C8 Plugins                                                                                                                                     |
| 路徑     | `src/plugins/`                                                                                                                                 |
| 設計檔   | [`docs/design/C8-plugins.md`](../design/C8-plugins.md)                                                                                         |
| 涉及缺口 | D1（guild-events 訂閱 guildCreate）、D2（`earthquake` plugin）、D3（移除 `src/events/`）、D4（`src/utils/` 收斂）、G-1（`console.error` 收斂） |

---

## D1 — `guild-events` plugin 訂閱 `guildCreate`（P1）

> port 介面定義見 [C3](C3-plugin-runtime.md) D1，`BaseBot` 實作見
> [C11](C11-bot-composition-roots.md) D1。此任務依賴兩者就緒。

- [ ] `guild-events` plugin 新增 `events.guildCreate` 訂閱
- [ ] 訂閱 handler 經 `ctx.resolve` 取 guild-onboarding port 完成新 guild 初始化
- [ ] 刪除 `src/events/guild_event.ts`
- [ ] 補 `guildCreate` 的 integration test

**驗收**：`guildCreate` 路徑不再穿透 `BaseBot` 內部結構；`src/events/guild_event.ts`
不存在。

---

## D2 — 新建 `earthquake` plugin（P1）

> `nijika` 組裝改動見 [C11](C11-bot-composition-roots.md) D2。

- [ ] 新建 `src/plugins/earthquake/`，工廠 `createEarthquakePlugin(config)`，
      `scope='bot'`
- [ ] `start` hook 內建立 Express 路由 `/discord/earthquake`，收速報後對各 guild
      的地震 channel 廣播
- [ ] 把 `earthquake_warning` 邏輯遷入 plugin `internal/`
- [ ] 刪除 `src/events/earthquake.ts`
- [ ] 補 plugin 生命週期與路由 integration test

**驗收**：`src/plugins/earthquake/` 存在；`src/events/earthquake.ts` 不存在。

---

## D3 — 移除 `src/events/` 過渡層（P1，依賴 D1 + D2）

> CJK scanner 的 `SCOPED_DIRECTORIES` 範圍更新見 [C10](C10-quality-gates.md) D3。

- [ ] 確認 D1（吸收 `guild_event.ts`）與 D2（吸收 `earthquake.ts`）已完成
- [ ] 刪除 `src/events/index.ts` 與整個 `src/events/` 目錄
- [ ] 移除 `tsconfig.json` 的 `@event` path alias
- [ ] 全 repo `grep "@event"` 確認為 0

**驗收**：`src/events/` 不存在；`grep "@event"` 為 0。

---

## D4 — `src/utils/` 收斂（P2）

> `JobManager` 承接評估見 [C1](C1-core-infrastructure.md) D4；`bot_cmd.ts` 承接
> 評估見 [C9](C9-codegen-scripts.md) D4；`@utils` alias 移除與 CLAUDE.md 更新見
> [C11](C11-bot-composition-roots.md) D4。

- [ ] 盤點 `bot_cmd.ts`、`job_manager.ts`、`misc.ts` 的所有 callsite（步驟 1，
      C1 / C9 的承接評估依賴此盤點結果）
- [ ] 依 C1 D4 評估結論，`JobManager` 遷入 `core/` 或 plugin `internal/`；
      giveaway / activity 的 `internal/` 改 import 新位置，不再 import
      `../../../utils/job_manager`
- [ ] giveaway / activity 的 `internal/` 不再 import `utils/misc`
- [ ] `misc.ts` 逐函式歸入消費端元件
- [ ] 依 C9 D4 評估結論遷出 `bot_cmd.ts`
- [ ] 刪除 `src/utils/` 目錄

**驗收**：`src/utils/` 不存在；giveaway / activity 不再 import `utils/*`。

---

## G-1 — `msgReact` 改用結構化 logger（P3）

- [ ] `src/plugins/giveaway/internal/giveaway.ts` 的 `msgReact` 把 `console.error`
      改為注入的 `Logger`（經 `deps.logger` 或 `ctx.logger`），記結構化欄位
- [ ] `src/plugins/activity/internal/activity.ts` 的 `msgReact` 同上

**驗收**：`src/plugins/` 無 raw `console.*`；ESLint `no-console` 於 production
code 綠。

---

## 交叉引用

- D1 port 介面：[C3 — Plugin Runtime](C3-plugin-runtime.md)；`BaseBot` 實作：[C11](C11-bot-composition-roots.md)
- D2 `nijika` 組裝：[C11 — Bot Composition Roots](C11-bot-composition-roots.md)
- D3 CJK scanner 範圍：[C10 — Quality Gates](C10-quality-gates.md)
- D4 承接點評估：[C1 — Core Infrastructure](C1-core-infrastructure.md)、[C9 — Codegen & Scripts](C9-codegen-scripts.md)；alias / CLAUDE.md：[C11](C11-bot-composition-roots.md)
