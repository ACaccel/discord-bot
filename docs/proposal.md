# 技術債修正需求規格（Tech-Debt Remediation Proposal）

| 項目     | 內容                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 目標     | 收斂 architecture-overhaul 完成後的剩餘技術債，使 codebase 達到「下一階段可長期維運」狀態                                            |
| 範圍     | R1 拆解 BaseBot、R2 消除 DI 旁路、R3 plugins↔core/ioc 契約對齊、R4 過長 handler 拆分 + 規範、R5 i18n 路徑反耦合、R6 低優先項一次掃乾 |
| 依據     | [docs/codebase-review-2026-05.md](codebase-review-2026-05.md) 第 2 / 6 節、[docs/revision.md](revision.md)                           |
| 交付方式 | 單一 feature branch；R1 → R2 → R3 → R4 → R5 → R6 依序完成後，一次 PR 到 `refactor/architecture-overhaul`                             |
| 文件層級 | 中階需求規格——說明「為何做、要達成什麼、什麼不做」；介面簽名、檔案結構、測試案例細節交給後續 design 文件                             |

---

## 1. 背景與動機

`refactor/architecture-overhaul` 分支已落地分層、Plugin host、IoC、Repository、Result、i18n 等基礎建設，並完成 TTS 移除、註解 release 化、`src/interface` → `src/i18n` 改名。對 codebase 做完整審閱（`docs/codebase-review-2026-05.md`）後仍有 6 項技術債（R1–R6）。本提案一次處理 R1–R6 全部，把架構大重構的尾巴一次掃乾，之後 `refactor/architecture-overhaul` 即可進入「對齊 main」階段。

選擇此時一次到位的理由：

- `BaseBot`（R1）已是其他重構的瓶頸——其他層的整潔度被它的肥大稀釋；R2、R3 也因 `BaseBot` 同時擁有「plugin 接點」與「raw event 接點」而難以單純化。先把 R1 做掉，後續每一輪重構的單位成本都會下降。
- DI 旁路（R2）與 plugins↔ioc 契約不一致（R3）是同一條主軸：IoC 邊界尚未真正被守住。一併處理可在同一分支內完整對齊。
- 過長 handler（R4）伴隨「準則 + ESLint 自動化」處理，新增 handler 將自動受規範保護，避免未來繼續累積。
- R5 是純粹的反耦合修正、R6 是分散的小修正集合；分多輪做反而會付不成比例的 PR / review 成本，一輪做完更划算。

---

## 2. 範圍

### 2.1 涵蓋

- **R1**：拆解 `BaseBot` 為 thin lifecycle owner，抽出三個 collaborator。
- **R2**：消除 plugin↔BaseBot 間的 module-global holder DI 旁路。
- **R3**：使 `src/plugins/**` 與 `core/ioc` 之間的依賴契約一致——契約、ESLint、實際 import 三者對齊。
- **R4**：拆分 4 個過長 handler 作為示範；引入 handler 行數準則與 helper 抽離守則；以 ESLint `max-lines-per-file` 強制執行。
- **R5**：移除 `catalog-loader.ts` 對 `src/i18n/locales` 的硬編碼路徑，改由 composition root 注入。
- **R6**：低優先單點修正集合（`traceId` 隨機性、`login()` 失敗 reject、清除殘餘 `console.*`、`BaseBot` 命名一致化、`src/bot/index.ts` import 中間執行碼搬移）。

### 2.2 不涵蓋

- **新功能、規格變更、Design Pattern 替換**（如換 DI 框架、改 ORM、改 i18n library）——本提案只清債，不擴張。
- **公開對外契約**（HTTP webhook 路由、Discord 指令簽名、i18n catalog key）——本提案不動。
- **TTS 功能**——已於前一輪移除，本提案不重新引入。
- **CI / CD pipeline 改造、依賴升級、Node 版本變更**——非本輪 scope。

---

## 3. 交付方式

- 開新 feature branch：建議 `refactor/tech-debt-cleanup`（最終名稱待確認）。
- 內部以 R1 → R2 → R3 → R4 → R5 → R6 的順序逐項實作；每項完成後執行所有 quality gates 才動下一項。
- R6 的子項（R6.1–R6.5）可在 R6 階段平行處理，但建議拆成獨立 commit，方便日後查找。
- 全部完成後**一次** PR 到 `refactor/architecture-overhaul`；PR description 逐項列出 R1–R6 的對應 commit。
- 每項都應在 commit 訊息中標註對應的 R 編號（例：`refactor(R1): extract GuildRegistrar from BaseBot`、`fix(R6.1): use crypto.randomUUID for traceId`）。

---

## 4. R1 — 拆解 `BaseBot`

### 4.1 動機

`src/bot/index.ts` 1,018 行、約 25 個 public 成員，同時擁有生命週期編排、IoC 接線、guild 註冊、per-guild DB 連線、reboot 訊息、8 個原生 `client.on` listener、reaction 抓取與分派、InteractionRouter 組裝。其 docstring 自稱「Thin lifecycle owner」與現況背離。這是本提案對維護性最重要的單一改動，所有後續重構都會受益於它。

### 4.2 要達成什麼

`BaseBot` 退回真正的 thin lifecycle owner；抽出三個職責清晰的 collaborator：

| Collaborator        | 領域職責                                                               |
| ------------------- | ---------------------------------------------------------------------- |
| `GuildRegistrar`    | 把 `Guild` 物件 + bot 設定組裝成 `GuildInfo`、解析 channels / roles    |
| `ClientEventBridge` | 把 Discord raw event 轉成已驗證的 domain event，交給 router / listener |
| `GuildDbConnector`  | 控制 per-guild Mongo 連線生命週期與失敗分類                            |

`BaseBot` 保留：constructor、`use(plugin)`、`run()` 的三段（setupContainer / setupTranslator / startListening）、shutdown 路徑、IoC 容器存取器。

`BaseBot` 對外的 public API（`bot.voice` / `bot.logger` / `bot.translator` / `bot.guildInfo` 等）**允許 breaking change**；handler / subclass / 測試端在同一個 R1 commit 內一併修正，外部不需保留相容 shim。

### 4.3 先決條件

R1 開始前先補齊 `BaseBot` 的 end-to-end contract 測試作為風險緩解。基線可參考 `test/integration/interaction-router/router-dispatch.int.test.ts` 的形式；目標是在拆解前，把現有 8 條 `client.on(...)` listener 的關鍵分支都納入整合測試。具體 fixture 與案例由 R1 的 design 文件展開。

### 4.4 不做什麼

- 不抽 `RouterAssembler`——InteractionRouter 組裝是一次性程序，本輪暫不獨立。日後若 router 真正長大，再列為單獨的 R 項。
- 不換 IoC 框架；不引入 `reflect-metadata`。
- 不改變 BaseBot 對外 lifecycle 順序（`use → run → shutdown`）的語意。

### 4.5 驗收（質化）

- `BaseBot` 退回「thin lifecycle owner」的描述能對得上實際內容——任何讀過 `src/bot/index.ts` 的工程師應同意 docstring 不再說謊。
- 三個新類別各自能用自己的測試獨立驗證；移除任一不會牽動其他兩個的測試。
- subclass（`Nijika` / `Konata` / `Tomori` / `MsgArchive`）仍能以同一個 plugin opt-in 模式組裝；breaking change 集中在欄位名稱或取值方式，不在生命週期語意。
- 全部既有測試（431 案）與 contract 測試新增案例皆綠。
- `architecture-reviewer` Audit 通過，無新增分層違規。

---

## 5. R2 — 消除 DI 旁路

### 5.1 動機

`src/plugins/voice/internal/active-controller.ts` 與 `src/infra/llm/models-catalog.ts` 以 module-scope 的可變 holder（`let active*`）把 plugin `init` hook 產出的物件傳給 `BaseBot.run()` 讀取。這是繞過 IoC 的隱藏全域旁路——新進工程師追 `bot.voice` 不會在容器裡找到接線，違反「DI 是唯一接線管道」的設計承諾。`active-controller.ts` 註解自承這個 holder 之所以存在是因為「plugin 契約沒有暴露 register 介面」——真正該補的是契約。

### 5.2 要達成什麼

擴充 plugin contract，給 plugin 一條合法的「向容器註冊已建立實例」的出口：

- `PluginContext`（plugin 的 `init` hook 收到的 ctx）增補 `registerInstance<T>` 能力。
- 該能力**只在 `init` hook 內合法**；在 `start` / `onReady` / event hook 等較晚階段呼叫，host 在 lifecycle runner 階段檢查並丟 `ConfigurationError`。
- `VoicePlugin.init` 改用 `ctx.registerInstance` 註冊 `VoiceController`；`BaseBot` 從容器解析（建議 `bot.voice` 改為 getter）。
- `models-catalog` 以同樣模式改寫；移除 `setActiveModelCatalog` / `getActiveModelCatalog` 等 module-global 函式。

### 5.3 不做什麼

- 不開放 plugin 直接取得 `ServiceContainer` 原物件——`ctx.registerInstance` 是窄面契約，不暴露 `register` / `registerSingleton` 之外的容器 API。
- 不改 plugin 既有的 `ctx.resolve(TOKENS.X)` 解析路徑。
- 不為了統一而把所有 plugin 都改成在 `init` 註冊實例；只動有 DI 旁路的兩處。

### 5.4 驗收（質化）

- `src/plugins` 與 `src/infra` 樹中不再存在 module-scope 可變 holder 作為 plugin↔BaseBot 通信管道。
- `bot.voice` / models-catalog 的 DI 路徑可由「BaseBot resolve token → plugin init 註冊 instance」一條 trace 完整對上。
- `ctx.registerInstance` 在非 `init` hook 呼叫時的拒絕行為有單元測試覆蓋。

---

## 6. R3 — plugins ↔ core/ioc 契約對齊

### 6.1 動機

8 個 `src/plugins/*/plugin.ts` 都 `import { TOKENS } from '../../core/ioc'`。分層契約規定 `core/ioc` 僅供 `src/bot/**` 與 `test/**`，但 `eslint.config.mjs` 的 `no-restricted-imports` 未列入 `src/plugins/**`，造成 lint 通過卻與契約矛盾。契約、ESLint、實際 import 三者必須一致，否則任何一邊都不可信。

### 6.2 要達成什麼

由 `core/plugin` 模組統一對 plugin 暴露其需要的 IoC 表面：

- `src/core/plugin/index.ts` 重新匯出 `TOKENS` 與 plugin 端必要的型別（如 `ServiceToken<T>`、`Resolver`）。
- 8 個 `plugin.ts` 改 import 來源為 `core/plugin`，不再直接觸碰 `core/ioc`。
- `eslint.config.mjs` 的 `no-restricted-imports` 把 `src/plugins/**` 加入禁止 import `core/ioc`，違規 fail。
- CLAUDE.md、CONTRIBUTING.md、`.claude/skills/project-conventions/SKILL.md`、`.claude/skills/coding-standards/SKILL.md` 對應段落同步更新——明文寫「plugin 對 IoC 的依賴透過 `core/plugin` 唯一管道」。

### 6.3 不做什麼

- 不在這一項裡擴充 `TOKENS` 內容；新 token（如 R2 的 `VoiceController` token）在 R2 階段處理。
- 不調整 plugin 的 `ctx.resolve(...)` API。
- 不為了「巨集化」而把 TOKENS 拆成多個 sub-namespace。

### 6.4 驗收（質化）

- 任何 plugin 程式碼不再直接 import `core/ioc`；違規由 ESLint 在 lint 階段擋下。
- 「plugin 對 IoC 的合法窗口」在程式碼、ESLint 規則、文件三處的描述一致。
- 換 IoC 框架的假想實驗：若日後抽換 `core/ioc`，plugin 程式碼不需更動。

---

## 7. R4 — 過長 handler 拆分 + 規範

### 7.1 動機

`src/handlers/commands/db_list_message/index.ts` 322 行，把日期解析、時間運算、reaction 文字渲染、附件組裝與 command class 全塞一檔；`inspect_member_ids`(172)、`emoji_frequency`(161)、`ai_settings`(158) 也偏長。一次性全拆會做出無價值的抽取；不處理則新進 handler 會繼續仿效。本項用「示範 + 規則 + 自動化 enforce」三件套同時收斂。

### 7.2 要達成什麼

#### A. 4 個示範拆分

對 `db_list_message` / `inspect_member_ids` / `emoji_frequency` / `ai_settings` 抽出 pure helper 至同目錄獨立模組；`index.ts` 只留 Discord I/O、權限檢查、Translator 呼叫、回覆組裝。每個抽出的 helper 應可獨立單元測試。具體模組劃分由 R4 的 design 文件決定，但成果應使這 4 個 `index.ts` 都低於下一節的行數門檻。

#### B. 規範

寫入以下文件：

- `CLAUDE.md`
- `CONTRIBUTING.md`
- `.claude/skills/project-conventions/SKILL.md`
- `.claude/skills/coding-standards/SKILL.md`

規範要點：

1. `src/handlers/<type>/<name>/index.ts` 行數上限 **150 行**（含 import、含 JSDoc）。
2. 超過上限的 pure helper（純函式、不依賴 Discord 物件）必須抽到同目錄獨立檔。
3. 不可為了壓縮行數而把 Discord I/O / 權限檢查 / Translator 呼叫拆出 `index.ts`——這些是 handler 的本職。
4. 抽出的 helper 須有對應單元測試。
5. 新 handler 寫作時即套用此規則，不留「未來再說」空間。

#### C. ESLint enforce

`eslint.config.mjs` 加 `max-lines-per-file` 規則，僅針對 `src/handlers/**/*.ts`，上限 150 行，違規 error。

### 7.3 不做什麼

- 不對 `src/handlers/**` 全樹做一次性掃蕩拆分；除示範的 4 個 + 任何被門檻擋下的之外，其他自然觸碰時再順手收斂。
- 不對 plugin / core / persistence 套用同一行數門檻——這些層的「行數=複雜度」對應關係不同。
- 不引入 cyclomatic complexity 或函式長度等其他 ESLint 規則——範圍蔓延風險。

### 7.4 驗收（質化）

- 4 個示範 handler 的 `index.ts` 全部低於 150 行；抽出的 helper 各自有單元測試。
- 行為位元等價：handler 既有測試全綠。
- `max-lines-per-file` 規則在所有現存（含未列為示範的）`src/handlers/**` 都過——若有現有超標檔，於同一輪一併處理或於 PR description 明列 follow-up。
- 規範文字在四份文件中內容一致，未來再修一處可順手檢查其餘三處。

---

## 8. R5 — i18n catalog 路徑反耦合

### 8.1 動機

`src/core/i18n/catalog-loader.ts` 的 `DEFAULT_LOCALES_DIR` 仍以
`path.resolve(__dirname, '..', '..', 'i18n', 'locales')` 硬編碼指向 `src/i18n/locales`。
這代表 `core/i18n` 知道內容層（`src/i18n/locales`）的目錄位置——是 core → content 的反向耦合，違反 core 不應感知下游層的分層契約。`src/interface` → `src/i18n` 改名雖已修字面，但耦合本身未解。

### 8.2 要達成什麼

把「內容層在哪裡」的知識從 core 搬到 composition root：

- `LoadCatalogOptions.localesDir` 改為**必填**；移除 `DEFAULT_LOCALES_DIR`。
- `createDefaultTranslator` 簽名改為必須接收 `localesDir: string`。
- 每個 composition root（`src/bot/{nijika,konata,tomori,msg-archive}/index.ts`）負責計算自己的 `localesDir`，以 `path.resolve(__dirname, ...)` 自行往上推到 `src/i18n/locales`。`bot/*` 屬於合成根，知道自己的部署佈局是合理的。
- 既有 test fixture 已顯式注入 `localesDir`，不受影響。

### 8.3 不做什麼

- 不引入新的設定檔（如 `i18n.config.json`）來描述 locale 位置——`path.resolve` 已足夠。
- 不改 catalog 內容、不改 catalog 結構、不改 i18next 設定。

### 8.4 驗收（質化）

- `grep -rn "'i18n'" src/core` 結果為空——core 不再字面提及內容層目錄。
- `LoadCatalogOptions` 的 `localesDir` 屬性型別不再 optional；呼叫端如未注入路徑會在編譯期被擋。
- 既有 catalog completeness 測試 / i18n 整合測試全綠。

---

## 9. R6 — 低優先單點清理

R6 是分散的小修正集合；每一子項皆獨立可驗證、互不相依。本輪一次做完，徹底結清「審閱出來的低優先項」。

### R6.1 `traceId` 隨機性升級

- 位置：`src/bot/index.ts:902`（router middleware 內）。
- 現況：`Math.random().toString(36).slice(2, 10)`。
- 修正：`crypto.randomUUID().slice(0, 8)`（或完整 UUID，視觀感）。
- 動機：高負載下 `Math.random()` 重複機率不可忽略，會讓 traceId 失去唯一性的本意；切換到 `crypto.randomUUID()` 是 Node 內建、零依賴。
- 驗收：traceId 來源呼叫 `crypto.randomUUID`；既有相關測試（如 router-dispatch 整合測試）綠。

### R6.2 `login()` 失敗應 reject

- 位置：`src/bot/index.ts:619-634`。
- 現況：`client.login(...).catch(err => log)`；失敗僅記錄，方法仍 resolve；`run()` 後續流程靠 `!this.client.user` guard 阻擋。
- 修正：`await client.login(...)`，catch 改為 re-throw；`run()` 在登入失敗即中止。
- 動機：登入失敗是不可恢復狀態；繼續走 `startAll()` 只會放大錯誤面、污染 log、留下半啟動狀態的 bot。
- 驗收：login 失敗時 `run()` 的 promise reject；單元測試（mock client.login 失敗）覆蓋此分支。

### R6.3 殘餘 `console.*` 清除

- 位置：`grep -rn 'console\.' src` 仍有約 25 處。
- 修正：改用 `bot.logger.info / warn / error`；對啟動前（logger 尚未就位）的呼叫，使用 `createBootstrapLogger()`。
- 動機：與「結構化 logger 為唯一輸出」的標準對齊，避免日誌格式分裂。
- 驗收：`grep -rn 'console\.' src --include='*.ts'` 結果為空（或全為刻意保留的 stderr fallback，並加上 i18n-ignore 等價的解釋註解）；`eslint` 的 `no-console` 規則對 `src/` 開為 `error`。

### R6.4 `BaseBot` 命名一致化

- 位置：`src/bot/index.ts` 與下游呼叫端。
- 現況：
  - `commandHandlers`（複數）vs `buttonHandler` / `modalHandler` / `ssmHandler` / `reactionHandler`（單數），同樣都是 `Map`。
  - `help_msg` / `guild_num` / `debug_ch` 等 snake_case 區域 / 欄位變數混在 camelCase 中。
- 修正：
  - 全部 Handler Map 統一為**複數命名**（如 `buttonHandlers`、`modalHandlers`、`ssmHandlers`、`reactionHandlers`）。
  - snake_case 變數改為 camelCase（`helpMessage`、`guildCount`、`debugChannel`）。
- 動機：handler、subclass、test 端搜尋與閱讀的認知負擔。
- 注意：屬 breaking change，須於 R1（同分支內）一併同步下游呼叫端；建議在 R1 commit 之後、R6.4 之前先讓 R1 落地，再做命名統一以縮小一次性 diff。
- 驗收：所有 Handler Map 命名一致；命名規則寫入 CLAUDE.md 的「命名」段落。

### R6.5 `src/bot/index.ts` import 中間夾執行碼搬移

- 位置：`src/bot/index.ts:31-38`，`sharedConnectionManagers` map 與 helper 函式夾在兩段 import 之間。
- 修正：把所有 `import` 移到檔案最上方（在 R1 拆解時順手處理）；`sharedConnectionManagers` 與 helper 放到 import 區段之後的第一個非 import 程式碼處。
- 動機：閱讀順序符合慣例；某些工具（auto-sort、bundler）對 interleaved import 行為不穩。
- 驗收：`eslint` 的 `import/first` 或 `import/order` 規則對 `src/bot/index.ts` pass；視覺上 import 區段連續。

---

## 10. 跨切議題

### 10.1 測試策略

- R1 開始前先補 contract / integration 測試（見 4.3）。
- 既有 431 個測試在每一項 R 完成後皆需全綠；不允許跳過或標記 `.skip`。
- R2 / R4 / R6.1 / R6.2 自然會新增單元測試；R3 / R5 / R6.3 / R6.4 / R6.5 不需新增（純 import 路徑替換、純 ESLint、純命名 / 排序）。

### 10.2 i18n / 文件影響

- R1–R6 不新增 i18n key；不刪 i18n key。
- R3、R4、R6.4 會修 CLAUDE.md / CONTRIBUTING.md / 兩個 SKILL.md；R1 / R2 若涉及 plugin contract 變動，亦同步 SKILL.md。
- `docs/wiki/` 在每項 R 完成後依 `update-wiki` skill 同步。

### 10.3 風險與緩解

| 項目 | 風險 | 緩解                                                                             |
| ---- | ---- | -------------------------------------------------------------------------------- |
| R1   | 高   | 4.3 的 contract 測試先補；BaseBot 改動分小步 commit；每步通過 quality gates 再續 |
| R2   | 中   | `ctx.registerInstance` 限制只在 `init` 呼叫，搭配 host 階段檢查 + 單元測試       |
| R3   | 低   | 純 import 替換；ESLint 一啟用即可發現遺漏                                        |
| R4   | 低   | 純函式抽取；ESLint 門檻可在 PR 內逐檔調整                                        |
| R5   | 低   | 介面收窄，呼叫端編譯期報錯即可發現遺漏                                           |
| R6.1 | 低   | Node 內建；既有測試覆蓋呼叫點                                                    |
| R6.2 | 中   | 改變 `run()` 失敗語意；須補 mock 失敗的整合測試，避免運維端錯愕                  |
| R6.3 | 低   | 純替換；可分檔次 commit                                                          |
| R6.4 | 中   | breaking change 面廣；搭配 R1 在同分支內一次到位，避免長期不一致                 |
| R6.5 | 低   | 純排序                                                                           |

### 10.4 退場條件

- `docs/codebase-review-2026-05.md` 第 2 / 6 節列出的全部高 / 中 / 低優先項目皆畫線完成。
- `architecture-reviewer` 對最終分支做 Audit，verdict 為 PASS。
- `reliability-reviewer` 對 R1 / R2 / R6.2 做 Audit，verdict 為 PASS。
- 全部 quality gate（typecheck / lint / test / format / knip / security / handlers:gen:check）綠。

---

## 11. 不涵蓋（明確排除）

- **新功能 / 新 plugin / catalog 內容變動**。
- **DI 框架替換、ORM 替換、i18n library 替換**——本提案不評估、不替換。
- **CI / CD pipeline 改造、依賴升級、Node 版本變更**。
- **公開對外契約**（HTTP webhook 路由、Discord 指令簽名 / 名稱、i18n catalog key）——本提案不動。
- **TTS 功能**——已於前一輪移除，本提案不重新引入。
- **將 `refactor/architecture-overhaul` 合入 `main`**——main 凍結 / branch protection 屬另一條工作流，非本輪 scope。

---

## 12. 後續

R1–R6 完成、本提案分支合入 `refactor/architecture-overhaul` 後：

1. 推進 `refactor/architecture-overhaul` 對齊 `main` 的合併策略討論（涉及 main 凍結 / branch protection）。
2. 本提案的退場數據（`BaseBot` 最終 LOC、新增測試數、ESLint enforce 範圍、`console.*` 殘留數）寫入 `docs/wiki/CHANGELOG.md`。
3. 評估是否啟動下一輪審閱（建議在 R1–R6 落地至少 4 週後，讓真實 maintenance / feature 工作驗證新結構），若有新技術債再行循環。
