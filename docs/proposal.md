# RFC: Discord Bot 架構重構工程 — 需求文件

| 欄位     | 內容                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------- |
| 文件類型 | 重構提案 / 需求規格（RFC 風格）                                                                                           |
| 目標分支 | `refactor/architecture-overhaul` → `main`                                                                                 |
| 文件版本 | 2.0                                                                                                                       |
| 最後更新 | 2026-05-20                                                                                                                |
| 讀者     | 技術團隊 / 工程師                                                                                                         |
| 相關文件 | [`docs/high-level-design.md`](high-level-design.md)、[`CONTRIBUTING.md`](../CONTRIBUTING.md)、[`CLAUDE.md`](../CLAUDE.md) |

---

## 1. 摘要

本 RFC 定義 Discord 多人格機器人 codebase 架構重構工程的**需求內容**。

此 codebase 同時託管四個 Discord 機器人人格（`nijika`、`konata`、
`tomori`、`msg-archive`）。重構前的程式碼以 `src/db`、`src/features`、
`src/events` 為主、bot 之間靠繼承 `BaseBot` 擴充，缺乏分層邊界、型別
安全與品質閘門。

重構工程的目標，是將其改造為一套 **Clean Architecture 分層 + Plugin
化** 的共用核心。本文件以**需求**為主體（第 5 節），逐項定義每個重構
需求的內容、動機與驗收標準；落地過程與排程僅作摘要記錄（第 6 節）。

---

## 2. 背景與動機

### 2.1 重構前的問題

| #   | 問題                                                           | 後果                                             |
| --- | -------------------------------------------------------------- | ------------------------------------------------ |
| P1  | 資料存取以 `bot.guildInfo[g].db.models["X"]` 字串查表          | 無型別、IDE 無法 go-to-definition、重構易漏      |
| P2  | 無分層邊界，業務邏輯散落 `features` / `events` / handler / bot | 跨層直接 mutation、職責不清                      |
| P3  | bot 靠繼承 `BaseBot` 擴充                                      | 行為差異難追蹤、共用核心被污染                   |
| P4  | infra 直接 `throw new Error()`                                 | 呼叫端無法 discriminate 錯誤，使用者只見泛用訊息 |
| P5  | user-facing 字串為硬編碼 literal                               | 無 i18n 紀律，散落各層                           |
| P6  | 品質閘門不完整（lint / coverage / 型別 scope 不全）            | 迴歸無自動化防護                                 |

### 2.2 重構所依循的兩大設計原則

1. **分層架構**：每個 `src/<layer>/` 目錄單一職責，僅能依賴下層；
   bot composition root 負責 wiring。
2. **Plugin 化的 bot 行為**：業務功能皆為註冊到 `PluginHost` 的
   `Plugin` 實例；每個 bot 自行挑選 plugin 集合，`BaseBot` 不再被繼承。

---

## 3. 目標與非目標

### 3.1 目標（Goals）

- 落地單向依賴的分層目錄結構。
- 以手寫 IoC 容器取代 Service Locator。
- 以 Plugin 契約 + PluginHost 取代 bot 繼承。
- 以 Repository pattern 取代字串查表式資料存取。
- 統一 LLM 存取為 Provider Strategy。
- 落地結構化錯誤樹與 `Result` 型別。
- 全面 i18n 路由並以 scanner 強制。
- 建立全 repo 品質閘門。

### 3.2 非目標（Non-Goals）

- **不**拆分獨立的 `src/domain/` 與 `src/application/` 兩層。以本專案
  規模，每個 use case 僅被單一 plugin 消費，拆兩層徒增間接層。此決定
  刻意為之（見 REQ-A7）。
- **不**引入 `reflect-metadata` 或第三方 DI 框架。
- **不**改動四個 bot 的對外行為（指令、回覆語意）；重構須行為等價。
- **不**在此工程內新增功能性 feature；僅做結構性重構。

---

## 4. 目標架構

完整說明見 [`docs/high-level-design.md`](high-level-design.md)，此處摘要。

```
src/
├── core/          # 純基礎設施（無 Discord / Mongo 依賴）
│   config · errors · i18n · ioc · logger · plugin · result · time · ids
├── persistence/   # Mongoose Repository pattern（schemas + repositories）
├── infra/         # 第三方 SDK adapter（mongo · llm · discord）
├── handlers/      # Discord interaction 進入點
├── interface/     # i18n locale catalog
├── plugins/       # 註冊至 PluginHost 的功能模組
└── bot/           # composition root（BaseBot + 各 bot wiring）
```

**依賴方向**：`bot → plugins → handlers → infra → persistence → core`，
單向向下；`core` 不依賴任何上層或第三方 SDK。

---

## 5. 重構需求

本節為文件主體。需求依領域分為 7 組（A–G）。每項需求標註對應的
audit-v2 條目編號（見[附錄 A](#附錄-a-audit-v2-與需求對照表)）。

### 5.A 分層與架構模式

#### REQ-A1 — 分層目錄結構

`src/` 依 `core` / `persistence` / `infra` / `handlers` / `interface`
/ `plugins` / `bot` 分層，每層單一職責、依賴單向向下。

**驗收**：每層僅 import 同層或下層；`core` 無 Discord / Mongo / 第三方
SDK 依賴。

#### REQ-A2 — 手寫 IoC 容器

以 `ServiceToken<T>` 型別化的手寫容器（約 150 行）管理依賴，取代
Service Locator。Plugin 透過 `ctx.resolve(TOKENS.X)` 取得依賴，runtime
hook 內不得直接觸及容器。

**驗收**：無 `reflect-metadata` / DI 框架依賴；eslint rule 禁止 plugin
runtime hook 內的 Service Locator。

#### REQ-A3 — Plugin 契約 + PluginHost

每個業務功能為 `Plugin<Config>`，含 `id` / SemVer `version` / `scope`
/ 生命週期 hook / 事件訂閱 / `contributes` 區塊。`PluginHost` 依宣告的
依賴拓撲排序 plugin，以錯誤隔離方式驅動生命週期 hook，並合併 plugin
貢獻的 handler 與 codegen registry。`BaseBot` 不再被繼承。

**驗收**：四個 bot 皆以 `this.use(...)` 組裝；依賴失敗的 plugin 級聯
停用；拓撲排序 / 生命週期順序有測試覆蓋。

#### REQ-A4 — InteractionRouter 中介層（audit 1.2）

`InteractionRouter` 採 Chain-of-Responsibility，作為 `BaseBot` 的主
dispatch 路徑；blocked-channel filter、權限檢查、channel logging 等
橫切邏輯抽為 middleware。

**驗收**：至少一個 bot 以 router 為主 dispatch 路徑，非 inline
`interactionEventListener → executeCommand`。

#### REQ-A5 — `Result<T, DomainError>` 邊界型別（audit 1.1）

use case 邊界以 `Result<T, DomainError>` 表達成功 / 失敗，取代散落的
`try/catch`。

**驗收**：`Result` 在 LLM service 與 repository 邊界有實際 production
callsite，非僅存在於 `core/result/` 與測試。

#### REQ-A6 — Plugin reboot self-ownership（ARCH-BLOCK3）

plugin 的 reboot（重啟期間重建排程 job）邏輯由 plugin 經 typed
dependency 自行擁有，不由外部 composition root 驅動。

**驗收**：reboot 路徑無跨層驅動；plugin readyAll 順序可保證。

#### REQ-A7 — 刻意不拆 domain / application 兩層（audit 1.4）

不引入 `src/domain/` 與 `src/application/` 目錄；use case 邏輯內聚於
對應 plugin。此決定須於 `docs/high-level-design.md` 明文記載，避免未來
讀者誤判為遺漏。

**驗收**：`docs/high-level-design.md` 有對應段落說明。

### 5.B 資料持久層

#### REQ-B1 — Repository pattern（audit 2.2）

資料存取改走 `<x>.repo.ts` 介面 + `Mongo<X>Repo` 實作；`buildRepos
(connection)` 回傳綁定特定 guild 連線的 `Repos` bundle。Plugin 與
handler 依賴介面，測試注入 in-memory fake。所有字串查表式
`db.models["X"]` callsite 須改為 `repos.xxx.<method>(...)`。

**驗收**：`grep "guildInfo[g].db.models["` 為 0；每個 repo 有
mongodb-memory-server integration test。

#### REQ-B2 — 退場 `src/db` shim（audit 2.1 / 2.7）

刪除 `src/db/` shim、`@db` path alias 與 `GuildInfo.db?: GuildDb` slot。

**驗收**：`grep "from '@db'"` 為 0；`src/db/` 不存在。

#### REQ-B3 — `src/features` 折進 plugins（audit 2.3）

`src/features/{giveaway,activity,llm_chat}` 折進對應
`src/plugins/<x>/internal/`；刪除 `@features` / `@llm_chat` alias。
job-scheduling 邏輯不得雙路徑並存。

**驗收**：`src/features/` 不存在；`@features` / `@llm_chat` alias 已刪。

### 5.C 錯誤處理與可觀測性

#### REQ-C1 — `DomainError` 錯誤樹（audit 3.2）

`core/errors/` 提供 `DomainError` 與子類（`ValidationError`、
`NotFoundError`、`ConflictError`、`PermissionError`、
`ExternalServiceError` → `DiscordApiError` / `DatabaseError` /
`LlmProviderError`、`ConfigurationError`）。每個錯誤帶 `code`、
`messageKey`、`messageParams`、`cause`。infra 層丟 `DomainError` 子類，
不得丟 raw `Error` / `TypeError`；handler catch 採 taxonomy 決定回覆。

**驗收**：`src/infra` 無 `throw new Error` / `throw new TypeError`；
handler 能依錯誤類型給出對應 `messageKey`。

#### REQ-C2 — operator-facing 訊息集中化（audit 3.3）

operator log 與 thrown Error message 集中為 message constant，不散落
英文 literal；scanner 補 rule 防止漂移。

**驗收**：infra / handler 層的 operator literal 走集中常數。

#### REQ-C3 — 連線失敗的明確降級（audit 3.7）

`connectGuildDB` 區分 transient（可重試）與 persistent 失敗；持續
失敗的 guild 進入 `disabledGuilds` map。該 guild 的 DB-touching
handler 回 `errors:db.guild_disabled` 並附 traceId，而非泛用
`errors:db.not_found`。

**驗收**：故意設壞測試 guild 的 Mongo URI，啟動後該 guild handler 回
`errors:db.guild_disabled` 附 traceId。

#### REQ-C4 — `requireGuildRepos` helper（audit 3.8）

DB-touching handler 重複的 `repos` null-check 樣板抽為單一
`requireGuildRepos(bot, interaction)` helper，並收斂 disabled-guild
訊息至單一修改點。

**驗收**：handler 不再複製 4 行 null-check 樣板。

#### REQ-C5 — reboot 非同步正確性（audit 3.1）

重啟期間重建排程 job 的迴圈不得使用 fire-and-forget `.then` /
`forEach(async)`；改用 `await Promise.all(map(...))` 並逐項
`try/catch` 走結構化 log。

**驗收**：reboot 期間人為製造失敗應走 `logger.errorLogger`，不產生
`unhandledRejection`；排程完成前函式不 return。

### 5.D LLM 存取

#### REQ-D1 — LLM Provider Strategy

四家 LLM SDK（OpenAI / Anthropic / Gemini / xAI）統一藏於 typed
interface 後，採 Strategy + Registry 模式，置於 `src/infra/llm`。

**驗收**：每家 provider 有 nock contract test；handler / plugin 僅
依賴 `LLMService` 抽象。

### 5.E 國際化（i18n）

#### REQ-E1 — Translator + catalog

`Translator`（i18next-backed）統一 user-facing 文案；catalog 置於
`src/interface/locales/<lang>/{commands,errors,replies}.json`，key
格式 `<namespace>:<feature>.<purpose>`。`src/handlers`、`src/plugins`、
`src/bot` 零 CJK literal。

**驗收**：上述目錄無 CJK literal；catalog-completeness 測試在 CI。

#### REQ-E2 — CJK literal scanner（audit 3.4）

scanner 以 strict mode 在 CI 強制掃描，範圍涵蓋 `src/handlers`、
`src/plugins`、`src/bot`。`src/events/` 過渡層已於概要設計中消除
（見 [`docs/high-level-design.md`](high-level-design.md) §9.4），
故不在掃描範圍。

**驗收**：scanner 為 CI gate；範圍含 `src/bot`。

### 5.F 型別安全與品質閘門

#### REQ-F1 — strict 型別涵蓋（audit 3.9）

strict tsconfig 的 `include` 涵蓋 `src/handlers/**`、`src/bot/**`、
`src/utils/**`；掃除 `any` escape，改以 `unknown` + narrowing。

**驗收**：strict typecheck 涵蓋全 `src`；`any` / `as any` 降至個位數
（intentional 處加註記）。

#### REQ-F2 — lint 全 repo gate（audit 1.3）

ESLint 覆蓋全 `src/**`，作為 CI gate（非僅 strict 子樹）。

**驗收**：`yarn lint` 涵蓋全 `src/**` 並在 CI 執行。

#### REQ-F3 — 測試覆蓋率門檻（audit 1.6）

`vitest` 設定 coverage threshold（core 高標、整體有下限）；CI 新增
`test:coverage` job 強制門檻。

**驗收**：`yarn test:coverage` 為 CI gate 並通過所設門檻。

#### REQ-F4 — Handler codegen + drift check

`scripts/gen-registry.ts` 掃描 `src/handlers/<type>/` 產生
`registry.generated.ts`；`handlers:gen:check` 在 CI 偵測 drift。

**驗收**：drift 在 PR 時被 `handlers:gen:check` 攔住。

#### REQ-F5 — 其他閘門

`typecheck` / `typecheck:emit` / `format:check` / `knip` 皆為 CI gate；
`yarn smoke` 提供四個 bot 的 pre-deploy 邊界探針。

**驗收**：上述指令皆在 CI 執行且綠。

### 5.G 結構整理與測試完備

#### REQ-G1 — 過大檔案拆模組（audit 3.5 / 3.6）

`BaseBot` 拆出 `setupContainer()` / `buildHost()` / `attachListeners()`
等 private helper；`message-backup/plugin.ts` 拆出 `internal/` 子模組；
`core/plugin/host.ts` 拆 `host/{lifecycle,contributes-merger,topology}.ts`。

**驗收**：上述檔案行數顯著下降，既有測試維持綠。

#### REQ-G2 — 退場過期 shim（audit 2.4 / 2.5 / 2.6）

退場 `src/utils/logger.ts`（callsite 全遷至 `core/logger`）、
`core/logger/from-process-env.ts`（強制走 `loadEnv`）、
`HandlerFactory.register(dir)` 反射路徑。連帶清除 production code 內所有
`eslint-disable` marker。

**驗收**：上述 shim 不存在；production code 0 個 `eslint-disable`。

#### REQ-G3 — `VoicePlugin` 抽離跨層 mutation（audit 3.10）

`BaseBot.voice` 由 handler 直接寫入的跨層 mutation 抽成 `VoicePlugin`；
`record` handler 透過 typed token resolve。

**驗收**：handler 不再直接寫 `bot.voice`。

#### REQ-G4 — 全域 slash command 註冊（audit 3.11）

`deploy.ts` 預設以 `Routes.applicationCommands(clientId)` 全域註冊；
保留 `--dev-guild` 供開發、`--cleanup-guild-commands` 清除舊殘留。

**驗收**：加入新 guild 不需重 deploy 即可看到完整指令。

#### REQ-G5 — Discord test fixtures + integration test（audit 1.5）

`test/fixtures/discord/` 提供 interaction / message / guild / member
builder 與 client fake；至少一個 `interaction → handler → use case →
repo` 的 integration test。

**驗收**：fixture builder 存在且被測試使用；有 interaction-level
integration test。

#### REQ-G6 — core facade 單元測試（audit 3.13）

`core/plugin/host.ts`、`core/ioc/container.ts`、`core/result/result.ts`
及 `persistence/repositories/*.repo.ts` 補齊 unit test，達 REQ-F3 門檻。

**驗收**：`yarn test:coverage` 通過 core 門檻。

#### REQ-G7 — kebab-case 目錄命名

bot 與 handler-type 目錄統一 kebab-case；handler 子目錄的 snake_case
名稱對應 Discord 指令名稱。

**驗收**：目錄命名一致。

---

## 6. 落地現況與計畫

> 本節為摘要，不展開逐 PR 進度。

重構工程分兩大波次落地，皆已合併進 `refactor/architecture-overhaul`：

- **Wave 1 — Phase 0–7**：落地分層、IoC、Plugin host、Repository、
  LLM Strategy、錯誤樹、i18n 與 scanner（PR #1–#26）。
- **Wave 2 — audit-v2**：依端到端審核（見[附錄 A](#附錄-a-audit-v2-與需求對照表)）
  補齊未落地的 pattern、退場全部 legacy shim、嚴格化型別與閘門、
  補齊測試（PR #31–#42，base = `refactor/architecture-overhaul`）。

**現況**：第 5 節所有需求（REQ-A1 ~ REQ-G7）對應的 audit-v2 條目均已
落地，`refactor/architecture-overhaul` HEAD 在 PR #42。

**剩餘工作**：開啟最終 `refactor/architecture-overhaul → main` PR。
須在完整品質閘門全綠、四個 bot 的 `yarn smoke` 與 manual regression
checklist 通過後，以 merge commit（不 squash）合併。

完整驗證指令：

```bash
yarn typecheck && yarn typecheck:emit
yarn lint && yarn format:check
yarn handlers:gen:check
yarn knip
yarn test && yarn test:coverage
yarn smoke --bot nijika   # konata / tomori / msg-archive 同
```

---

## 7. 風險與緩解

| 風險                                    | 影響       | 緩解                                                   |
| --------------------------------------- | ---------- | ------------------------------------------------------ |
| 行為等價無自動化保證，依賴 manual smoke | 上線回歸   | 最終合併前跑四 bot smoke + manual regression checklist |
| 最終合併分支與 `main` 長期分歧          | 合併衝突   | 合併前 rebase / merge `main`，重跑完整閘門             |
| 部分原始 Phase 0–7 計畫文件已佚失       | 需求追溯難 | 本 RFC 以 audit-v2 報告為單一事實來源（附錄 A）        |

---

## 附錄 A — audit-v2 與需求對照表

audit-v2 端到端審核（原始報告
`.claude/plans/codebase-1-eventual-whale.md`）輸出 24 項修正細項，加上
review 過程新增的 ARCH-BLOCK3，全部對應到第 5 節需求。

| audit 條目  | 標籤  | 對應需求 |
| ----------- | ----- | -------- |
| 1.1         | BLOCK | REQ-A5   |
| 1.2         | BLOCK | REQ-A4   |
| 1.3         | BLOCK | REQ-F2   |
| 1.4         | NOTE  | REQ-A7   |
| 1.5         | WARN  | REQ-G5   |
| 1.6         | WARN  | REQ-F3   |
| 2.1 / 2.7   | BLOCK | REQ-B2   |
| 2.2         | BLOCK | REQ-B1   |
| 2.3         | BLOCK | REQ-B3   |
| 2.4         | WARN  | REQ-G2   |
| 2.5         | WARN  | REQ-G2   |
| 2.6         | WARN  | REQ-G2   |
| 3.1         | BLOCK | REQ-C5   |
| 3.2         | BLOCK | REQ-C1   |
| 3.3         | BLOCK | REQ-C2   |
| 3.4         | WARN  | REQ-E2   |
| 3.5         | WARN  | REQ-G1   |
| 3.6         | WARN  | REQ-G1   |
| 3.7         | WARN  | REQ-C3   |
| 3.8         | WARN  | REQ-C4   |
| 3.9         | WARN  | REQ-F1   |
| 3.10        | WARN  | REQ-G3   |
| 3.11        | WARN  | REQ-G4   |
| 3.13        | NOTE  | REQ-G6   |
| ARCH-BLOCK3 | BLOCK | REQ-A6   |

> 註：被 audit-v2 報告引用的原始 Phase 0–7 重構計畫（含 §1.1、§5A 等
> 章節編號）已不在 repo。本 RFC 以 audit-v2 報告為單一事實來源。
