# 正式發行版整備計畫（Release Readiness Proposal）

**狀態：** 草案，待審閱。
**目標 branch：** `refactor/architecture-overhaul`（已合併 `refactor/tech-debt-cleanup` 的 R1–R6 成果）。
**發行型態：** 公開 OSS 發行（v1.0.0）。
**本文件產出：** 將 codebase 落地為首版公開發行的範圍化行動計畫——涵蓋程式碼品質、文件清理、`README.md` / `CONTRIBUTING.md` / `CLAUDE.md` 三份文件重寫、補齊 OSS 標準附屬文件，以及 `.claude/` agents 與 skills 的發行版改寫。

本文件為**規劃文件**，不含任何程式碼或檔案修改。

---

## 1. 審閱結果

### 1.1 模組化、物件導向與 design pattern — 判定：PASS

Codebase 已達且多處超出商業標準。R1–R6 技術債清理（已併入 `architecture-overhaul`）強化了 architecture overhaul 階段建立的分層。

已正確套用的 pattern 與代表位置：

| Pattern                              | 位置                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Clean / 分層架構                     | `core → persistence/infra → handlers/plugins → bot`，ESLint 強制依賴方向                                            |
| 手寫 IoC container（typed tokens）   | [src/core/ioc/container.ts](../src/core/ioc/container.ts)（約 280 行，無 `reflect-metadata`）                        |
| Plugin / Host（lifecycle + dispatcher）| [src/core/plugin/](../src/core/plugin/) — 拓樸序註冊、`Promise.allSettled` 事件隔離                                |
| Chain of Responsibility（middleware）| [src/core/plugin/interaction-router.ts](../src/core/plugin/interaction-router.ts) + [src/bot/middlewares.ts](../src/bot/middlewares.ts) |
| Strategy（LLM providers）            | [src/infra/llm/](../src/infra/llm/) — OpenAI / Anthropic / Gemini / xAI 共用單一介面                                |
| Repository pattern                   | [src/persistence/repositories/](../src/persistence/repositories/) — interface + `Mongo<X>Repo`                      |
| Adapter                              | [src/bot/client-event-bridge.ts](../src/bot/client-event-bridge.ts) — discord.js 事件 → router / dispatcher         |
| Factory（plugin / repo bundle）      | `createXxxPlugin(rawConfig)`、`buildRepos(connection)`                                                              |
| Result / Either                      | [src/core/result/](../src/core/result/)                                                                             |
| Branded primitive types              | [src/core/ids.ts](../src/core/ids.ts)（GuildId、ChannelId 等）                                                       |
| 結構化錯誤樹                         | [src/core/errors/](../src/core/errors/) — `DomainError` taxonomy 並以 `messageKey` 串接 i18n                        |
| Singleton pool                       | Process 範圍 `MongoConnectionManager`，以 URI 為 key（[src/bot/index.ts:88](../src/bot/index.ts#L88)）                |

**程式碼層級的小幅改善**列於 §4，皆為選擇性；無一項阻擋發行。

### 1.2 商業標準 / 易讀性 / 安全 / 簡潔 — 判定：PASS（含少量必修）

現況已具備：

- **嚴格 TypeScript**——`tsconfig.strict.json` 覆蓋整個 `src/`，`any`、`as any`、未收斂的 `unknown` 一律失敗。
- **CI 品質閘**——十條必過 status checks（`lint`、`typecheck`、`typecheck-emit`、`test-unit`、`test-coverage`、`test-int`、`test-contract`、`knip`、`security`、CodeQL `analyze`），加上 i18n 對齊與 CJK literal 掃描。
- **安全**——`audit-ci` 含 allowlist、`gitleaks`、`core/config/env.ts` 以外不得 `process.env` 直接讀（ESLint 強制）、無硬編碼 secret、Mongoose 參數化查詢、[src/core/config/redact.ts](../src/core/config/redact.ts) 與 [src/core/logger/](../src/core/logger/) 提供 redaction。
- **結構化 logging**——pino 帶 bot / guild / trace context；`src/` 內 `console.*` 為 `error` 等級禁用（R6.3）。
- **測試金字塔**——unit / integration / contract / i18n 共 103 個測試檔。
- **Codegen 漂移閘**——`yarn handlers:gen:check` 擋下 handler 目錄與生成 registry 不一致的 PR。
- **Process safety nets**——`installProcessHandlers` 連結 `SIGINT` / `SIGTERM` / `unhandledRejection` 至 graceful shutdown。

公開發行前的必修項（完整清單見 §4）：

1. `README.md` 為 refactor 前版本，描述已不存在的 `commands/` 目錄結構，誤導性高，必須重寫。
2. `CONTRIBUTING.md` 引用內部工程產物（`engineering-orchestrator`、gap-remediation、auto-merge 政策、`refactor/architecture-overhaul` branch protection），對外部貢獻者無意義。
3. `CLAUDE.md` 圍繞 R1–R6 工程組織，指向 `docs/tasks/`、`docs/design/` 與內部 agents，需改寫為「協助社群貢獻者的 AI 助理視角」。
4. 缺少 `SECURITY.md`、`CODE_OF_CONDUCT.md`、頂層 `CHANGELOG.md`，皆為標準 OSS 預期。
5. `CLAUDE.md` 與 `CONTRIBUTING.md` 嵌入兩段中文（Handler 行數規範、Plugin ↔ IoC 契約），對外發行版需翻成英文。
6. `package.json` `description: ""`，`version: 1.0.0` 但尚未建立對應 tag，`engines.node`（`>=22.13.0`）與 `CONTRIBUTING.md`（「Node 20+」）不一致。需擇一為準並對齊。
7. `lint:legacy` / `typecheck:legacy` npm scripts 已成為死碼（strict mode 已覆蓋整個 `src/`），應移除。

### 1.3 過去修改紀錄 — 判定：發行前刪除

以下為 architecture overhaul 與 R1–R6 清理的工程進行中產物，不適合保留於公開發行版。完整清單與理由見 §3。

---

## 2. 目標

將 `refactor/architecture-overhaul` 合併至 `main`，作為專案的 v1.0.0 OSS 發行版，達成：

- 純英文、面向貢獻者、反映**當下程式碼**（而非 refactor 歷史）的文件。
- repo 內無任何內部工程產物。
- 標準 OSS 檔案齊備（`README`、`CONTRIBUTING`、`LICENSE`、`CHANGELOG`、`SECURITY`、`CODE_OF_CONDUCT`）。
- 程式碼品質至少不低於現況；含小幅低風險清理（§4）。
- `.claude/` 之 agents 與 skills 改寫為通用、可長期沿用的發行版規範。

---

## 3. 檔案系統異動

### 3.1 應刪除的文件

`docs/` 之下：

| 路徑                                  | 理由                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------- |
| `docs/proposal.md`（舊版）            | Architecture overhaul 需求規格——已被本文件與新版發行文件取代               |
| `docs/high-level-design.md`           | Refactor 演進敘事——重點蒸餾為新版 `docs/architecture.md`                   |
| `docs/design.md`                      | `docs/design/R*.md` 的索引——已過時                                         |
| `docs/design/`（整個目錄）            | R1–R6 實作骨架與 `gaps.md`——純內部工程                                     |
| `docs/tasks/`（整個目錄）             | R1–R6 task checklist 與 `progress.md`——純內部工程                          |
| `docs/codebase-review-2026-05.md`     | 啟動本次清理的審閱報告——歷史性                                             |
| `docs/revision.md`                    | 階段性修訂計畫——歷史性                                                     |

Wiki 清理（`docs/wiki/`）：

| 路徑                          | 動作                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `docs/wiki/CHANGELOG.md`      | 改寫為以發行版為錨點的 changelog（`v1.0.0 — initial public release`），刪除目前全部 24 筆 R / D / G 標籤條目              |
| `docs/wiki/Home.md`           | 改寫：移除指向 `docs/tasks/README.md`、`docs/design/gaps.md`、`engineering-orchestrator` 的連結與「元件完成度」表，保留元件地圖 |
| `docs/wiki/components/C*.md`  | 逐頁審視，移除進行中工程、R 標籤、agent 名稱等引用，重新聚焦於「該元件當下做什麼」                                          |

### 3.2 應重寫的文件

| 路徑              | 改寫範圍                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `README.md`       | 全面重寫——見 §3.4。目前內容描述 refactor 前的 `commands/` 結構，具誤導性                                                |
| `CONTRIBUTING.md` | 大幅重寫——見 §3.5。移除 R 標籤、`engineering-orchestrator`、auto-merge 政策、`refactor/architecture-overhaul` 相關內容，中文段落英譯 |
| `CLAUDE.md`       | 重新定位為「協助社群貢獻者的 AI 助理視角」——見 §3.6。刪除整段「Active engineering: Tech-Debt Cleanup (R1–R6)」與文件鏈引用 |

### 3.3 應新增的 OSS 標準文件

| 路徑                    | 用途                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `CHANGELOG.md`（根目錄）| Keep-a-Changelog 格式。`v1.0.0 — YYYY-MM-DD` 含特性摘要                                                                       |
| `SECURITY.md`（根目錄） | 支援版本、漏洞通報管道（建議採 GitHub Security Advisory）、責任揭露時程                                                       |
| `CODE_OF_CONDUCT.md`    | Contributor Covenant 2.1——標準 OSS 預期                                                                                       |
| `docs/architecture.md`  | 取代 `high-level-design.md`。單頁架構總覽：分層、關鍵抽象、request flow、plugin lifecycle。讀者＝評估或擴充本 bot 的開發者     |

### 3.4 `README.md` 改寫大綱

目標讀者：在 GitHub 上看到 repo、正在決定要使用 / fork / 貢獻的開發者。

章節順序：

1. **一行描述 + badges**——CI 狀態、license、Node 版本。
2. **這是什麼**——TypeScript / Discord.js / MongoDB 多人格 bot framework，重點：分層架構、plugin system、i18n、嚴格 TypeScript。
3. **內建 bots**——短表：`nijika`（web-facing + 地震 webhook）、`konata`、`tomori`、`msg-archive`（worker-style 備份）。
4. **特性**——對使用者列出 bullet：slash commands、reactions、modals、scheduled jobs、多 provider LLM chat（OpenAI / Anthropic / Gemini / xAI）、雙語（zh-TW + en）、語音錄製、訊息備份、giveaway、活躍度追蹤、地震播報。
5. **快速開始**——`git clone`、`yarn install --frozen-lockfile`、每 bot 的 `.env` + `config.json` 設定、`yarn <bot-name>`。
6. **設定**——指向 [src/core/config/env.ts](../src/core/config/env.ts) 的 zod schema，簡述每個必需與選擇性 env var。
7. **新增 bot / command / plugin**——各一句帶過，連結至 `CONTRIBUTING.md`。
8. **架構總覽**——5–10 行，連結至 `docs/architecture.md`。
9. **開發**——`yarn typecheck`、`yarn lint`、`yarn test`。
10. **貢獻**——連結至 `CONTRIBUTING.md` 與 `CODE_OF_CONDUCT.md`。
11. **安全**——連結至 `SECURITY.md`。
12. **授權**——MIT，連結至 `LICENSE`。

### 3.5 `CONTRIBUTING.md` 改寫大綱

保留實質工程指引，移除進行中內部工程片段。

**保留**（重新潤飾、僅英文）：

- Local setup（Node 版本、Yarn classic、MongoDB、ffmpeg）。
- Quality gates 表——十條閘全留。
- 三條 load-bearing 架構規則：no CJK literals、`process.env` 限 `core/config`、無測試不得新增 handler / plugin。
- 「Adding a slash command」recipe。
- 「Adding a plugin」recipe。
- 「Handler 150-line cap」——現有中文段落英譯為 bullet 形式。
- 「Plugin ↔ IoC contract」——現有中文段落英譯。
- `yarn smoke` 說明。
- Commit conventions（移除 `Co-Authored-By: Claude` 強制行，那是專案所有者的個人慣例，非外部貢獻者要求）。

**刪除**：

- `refactor/architecture-overhaul` 專屬的必過 status checks 清單（branch protection 將在發行後改套用至 `main`）。
- Auto-merge 預設與自主合併政策（純內部）。
- `engineering-orchestrator` agent 與 PR template reviewer agents 引用。
- 「Branch off `refactor/architecture-overhaul`（until that lands on `main`）」——發行後過時。

### 3.6 `CLAUDE.md` 改寫大綱

目標讀者：在乾淨 checkout 上協助貢獻者的 AI 助理。檔案應精簡（目前 13 KB → 目標 ≤ 7 KB）。

**保留**（壓縮）：

- 一段專案摘要。
- 目錄結構表。
- Path aliases。
- 關鍵抽象（BaseBot、Plugin contract、Repository、Error tree、i18n、IoC）——刪除 R1 / R2 / R3 等標籤註解，只描述當下狀態。
- Quality gates 指令清單。
- 三條架構規則（與 `CONTRIBUTING.md` 一致）。
- 指向 `docs/architecture.md` 與 `CONTRIBUTING.md`。

**完全刪除**：

- 「Active engineering: Tech-Debt Cleanup (R1–R6)」段與文件鏈。
- 「Agents and skills」段——其中內部專用 agent 不對外曝光；保留的部分以 §3.7 為準重新撰寫。
- 「Commit + PR conventions」中引用 `refactor/tech-debt-cleanup` → `refactor/architecture-overhaul` 的句子。

### 3.7 `.claude/` agents 與 skills 發行版改寫

專案於 `.claude/` 提供 8 個 agents 與 4 個 skills。其中數個與 R1–R6 清理強耦合（指向特定文件、特定流程），合併後無存在意義；其餘為通用 reviewer / 規範工具集，對任何使用 Claude Code 的貢獻者皆有價值。按下列方式拆分。

**應刪除的 agents**（R 清理專用，無通用價值）：

| 路徑                                          | 理由                                                                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `.claude/agents/tech-debt-orchestrator.md`    | R1–R6 領隊 agent；引用 `docs/tasks/progress.md` 與 `r-implementer`。發行後 repo 無對應流程。                                  |
| `.claude/agents/r-implementer.md`             | R item worker agent；讀取 `docs/tasks/R<N>.md`（將刪）與 `docs/design/R<N>.md`（將刪），無法獨立運作。                       |

**應保留並改寫的 agents**（6 個 reviewer agents——對 repo 任何 PR 審查皆適用）：

| 路徑                                                   | 改寫要點                                                                                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `.claude/agents/architecture-reviewer.md`              | 移除「for the discord-bot refactor」框架，改為描述**當下**的 layer contract（不再寫「R1 decomposes…」）；保留 Consult / Review / Audit 三模式 |
| `.claude/agents/type-system-reviewer.md`               | 刪除「Heavy use on C1 / C2 / C4 / C5」等 gap tag；保留 strict mode / generics / Result / discriminated union 重點             |
| `.claude/agents/reliability-reviewer.md`               | 刪除「Heavy use on C5（D5 …）、C8（reboot async correctness）、C3（plugin lifecycle ordering）」；改述為「適用於任何牽涉 retry / lifecycle / partial failure 的變更」 |
| `.claude/agents/test-architect.md`                     | 刪除 R / D / G 引用；改述為當下 test project 布局（unit / integration / contract / i18n）                                     |
| `.claude/agents/config-and-security-reviewer.md`       | 刪除「silent-pass detection」等審計期語言；保留 audit-ci / gitleaks / secret-redaction 範疇                                  |
| `.claude/agents/i18n-discipline-reviewer.md`           | 刪除「Heavy use on C6 / C7（gaps D7、D9）」；改述為「永久啟用的 CJK scanner + 雙語 catalog 不變式」                          |

六個 reviewer 共同要求：

- 內文一律英文。
- 移除任何 gap code 引用（`R1`、`R2`…、`D7`、`D9`、`G-1`、`G-2`、元件代號 `C1`–`C11`）。
- 移除「Will be the primary reviewer for the X work」這類句型，改為「Applies when changing X」的分層描述。
- 僅引用公開文件（`README.md`、`CONTRIBUTING.md`、`docs/architecture.md`、`docs/wiki/components/`），不引用 `docs/tasks/`、`docs/design/`。

**應刪除的 skills**：

| 路徑                                         | 理由                                                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `.claude/skills/r-task-workflow/SKILL.md`    | 整個 skill 描述如何執行 `docs/tasks/R<N>.md` 任務；發行後無 R 任務存在                                                       |

**應保留並改寫的 skills**：

| 路徑                                            | 改寫要點                                                                                                                    |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `.claude/skills/project-conventions/SKILL.md`   | 移除「post-refactor」語感（這就是架構，不是後遺症）；移除 R / D / G 自檢項；加入 `CONTRIBUTING.md` 三條 load-bearing 規則    |
| `.claude/skills/coding-standards/SKILL.md`      | 已大致通用；修剪指向被刪 `CLAUDE.md`「tech-debt cleanup」段的引用                                                            |
| `.claude/skills/update-wiki/SKILL.md`           | 刪除「每個 R 完成後」觸發；改述為「任何新增 / 刪除 / 修改程式碼或文件後」；刪除 R 標籤範例                                  |

**應新增的 skill**（取代被刪的 `r-task-workflow`）：

| 路徑                                           | 用途                                                                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `.claude/skills/contribute-change/SKILL.md`    | 任意變更的通用貢獻流程：理解區域 → 規劃 → 實作 → 對 `coding-standards` + `project-conventions` 自檢 → 跑 quality gates → 更新 wiki + changelog → commit。對應 `CONTRIBUTING.md` 但以 skill 形式存在，Claude Code 於貢獻者開始工作時按需載入 |

**應新增的 agent**（取代被刪的 `r-implementer`，提供長期可用的「增刪修改」實作 subagent）：

| 路徑                                       | 用途                                                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `.claude/agents/change-implementer.md`     | 通用實作 agent。接受任意「新增 / 刪除 / 修改」任務（handler、plugin、core、infra、persistence、docs、設定），無領域綁定。內部由載入的 `contribute-change` skill 驅動流程，並依改動所在層挑選相應 reviewer agent（architecture / type-system / reliability / test / config-and-security / i18n）做 Consult / Review。 |

`change-implementer` 規格要點：

- **觸發**：由主 agent（或使用者）派工，給定一段 task description；agent 不接「整批 R 列表」這種多任務工作流。
- **輸入合約**：一段自然語言任務 + 必要時的具體檔案 / 路徑指引；無外部 `docs/tasks/*.md` 依賴。
- **工作流**：載入 `contribute-change` skill → 用 `Read` / `Grep` / `Glob` 理解相關區域 → 列計畫 → 實作 → 對 `coding-standards` 與 `project-conventions` 自檢 → 視動到的層派出對應 reviewer 做 Review → 跑 quality gates 直到全綠 → 視需要更新 wiki / changelog → 產生 commit message → 回報。
- **Reviewer 派遣表**（agent 內建決策樹，避免主 agent 重複決定）：

  | 改動位置                                            | 必呼叫 reviewer                       |
  | --------------------------------------------------- | ------------------------------------- |
  | `src/core/` / `src/bot/` 或新增 / 刪除模組          | architecture-reviewer                 |
  | 任何 TypeScript 型別、generics、Result、union 改動  | type-system-reviewer                  |
  | 牽涉 retry、lifecycle、async、partial failure       | reliability-reviewer                  |
  | 新增 / 修改測試或 quality gate                      | test-architect                        |
  | `package.json` / CI / ESLint / tsconfig / secret    | config-and-security-reviewer          |
  | `src/i18n/locales/` 或 user-facing 字串            | i18n-discipline-reviewer              |

- **Tools**：`Read, Write, Edit, Bash, Grep, Glob, Agent`（與 `r-implementer` 同等，去掉 R-specific 依賴）。
- **Model**：`opus`。
- **不做的事**：不規劃多任務或排程；不接「請完成 R6」式的清單；不自行決定何時 merge / push。這些屬於上游決策。

發行版 agents 與 skills 的 **frontmatter 規範**（以呈現為一套對外可用的精緻 catalogue，而非工程日誌）：

- `name:`——kebab-case，描述角色，不加專案前綴。
- `description:`——首句說明用途，末句說明何時呼叫；無 R / D / G 代碼；≤ 280 字。
- `tools:`——最小必要集合。Reviewer agents 一律唯讀（`Read, Grep, Glob, Bash`）；skills 不宣告 tools。
- `model:`——reviewer agents 保留 `opus`；skills 不寫 `model`。
- 本文——英文、現在式、無「本 skill 建立於 X 階段」歷史敘述；讀起來像文件，不像日誌。

### 3.8 應刪除的 branches

`refactor/architecture-overhaul` 合併至 `main` 之後：

- `refactor/tech-debt-cleanup`（local + `origin/`）——已完全合併。
- `refactor/release-comments-and-tts-removal`（local + `origin/`）——已完全合併。
- `refactor/architecture-overhaul`（local + `origin/`）——合併完成後刪除。

對遠端為破壞性動作，列為合併後最終步驟並需明確再確認方可執行。

---

## 4. 程式碼層級異動

全為選擇性與低風險，每項皆可獨立 revert，無一改變終端使用者可見行為。

### 4.1 必做的程式 / 設定清理

下列為發行前必須完成的處理，與文件改寫同層級，不可省略。每項皆為小幅、低風險、可獨立 revert。

1. **移除已死的 `lint:legacy` / `typecheck:legacy` scripts**（`package.json`）——strict 模式已覆蓋全 `src/`，legacy gate 純為噪音。
2. **對齊 Node 版本至 `>=22.13.0`**——以 `.nvmrc` 為唯一權威：`package.json` `engines.node` 已是 `>=22.13.0`，需將 `CONTRIBUTING.md` 與其餘文件文字一併對齊；CI workflow 若有 `node-version: 20` 殘留亦需修正。
3. **填寫 `package.json` `description`**——目前為 `""`；以一行說明專案性質（例：`Multi-bot Discord framework on TypeScript, Discord.js and MongoDB, with a layered plugin architecture and bilingual i18n.`）。
4. **顯式採用 SemVer 發行**——本次刻意將 `version` 升為 `1.0.0` 並建立對應 `v1.0.0` git tag；目前 `1.0.0` 但無 tag。tag 於合併至 `main` 後同 commit 內建立。
5. **`package.json` 補上 `keywords`**——`discord-bot`、`discord.js`、`typescript`、`mongodb`、`plugin-architecture`、`i18n`、`llm`、`openai`、`anthropic`、`gemini`。即使不發佈至 npm，亦有助 GitHub topics 自動填入。
6. **每個 bot 確認 `config.example.json` 存在**——`src/bot/<name>/`（`nijika` / `konata` / `tomori` / `msg-archive`）之下皆需提供範例設定；真實 `config.json` 維持 `.gitignore`。範例需涵蓋 `guilds`、`channels`、`roles`、`commands` 四欄並以假 ID 填充。`README.md` 與 `CONTRIBUTING.md` 的快速開始皆需指向此範例檔。

7. **`BaseBot.guildInfo` 收斂為唯讀 API**——v1.0.0 為首次公開發行，趁此一次完成 API 收斂，避免發行後再做 breaking change。

   **設計**：

   - 將 [src/bot/index.ts](../src/bot/index.ts) 內的 `public guildInfo: Record<string, GuildInfo> = {}` 替換為私有 `#guildInfo: Map<string, GuildInfo>`（class field 私有語法，TS 對外即不可見）。
   - 新增三個公開 getter，作為唯一對外讀取面：

     ```ts
     /** Look up one guild's info. Returns undefined when unregistered. */
     public getGuildInfo(guildId: string): Readonly<GuildInfo> | undefined;

     /** Readonly view over every registered guild. */
     public getAllGuildInfo(): ReadonlyMap<string, Readonly<GuildInfo>>;

     /** Convenience accessor for the common case of just needing repos. */
     public getRepos(guildId: string): Repos | undefined;
     ```

     回傳型別以 `Readonly<GuildInfo>` 與 `ReadonlyMap` 阻擋外部寫入。
   - [src/bot/index.ts](../src/bot/index.ts) 內的 `GuildInfo` interface 全欄位加上 `readonly`：

     ```ts
     export interface GuildInfo {
         readonly bot_name: string;
         readonly guild: Guild;
         readonly channels?: Readonly<Record<string, Channel>>;
         readonly roles?: Readonly<Record<string, Role>>;
         readonly repos?: Repos;
     }
     ```

     `Repos` 由 `buildRepos(connection)` 產生且本身為 readonly bundle，自然滿足條件。
   - 寫入面僅留給 `BaseBot` 自身：新增私有 method `#setGuildInfo(guildId, info)` 與 `#attachRepos(guildId, repos)`，供 `handleClientReady`（吸收 `GuildRegistrar.registerAll` 結果）與 `GuildDbConnector` 寫回 repos 使用。`GuildDbConnector.connectOne` 由原本「直接 mutate `slot.repos`」改為「回傳 `Repos`，由 BaseBot 透過 `#attachRepos` 寫入」，保持 R1 collaborator 的單一職責邊界。
   - `GuildRegistrar.registerAll` 維持回傳 `Record<string, GuildInfo>`（或改為 `Map`，依實作便利擇一），BaseBot 在 `handleClientReady` 將其重灌入私有 Map。
   - [src/core/guild-registry.ts](../src/core/guild-registry.ts) 的 `getRepos` / `getChannel` / `getRole` / `listGuildIds` 改建構於新的 readonly 視圖之上。對 plugin 端無 API 變動（plugin 一向透過 `GuildRegistry` 取資料）。

   **Callsite 遷移**：

   - 以 `grep -rE "bot\.guildInfo(\[|\.)" src/ test/` 列出所有讀取點，逐一改為對應 getter：
     - `bot.guildInfo[guildId]` → `bot.getGuildInfo(guildId)`
     - `bot.guildInfo[guildId]?.repos` → `bot.getRepos(guildId)`
     - `Object.keys(bot.guildInfo)` / `Object.values(...)` → `bot.getAllGuildInfo().keys()` / `.values()`
     - `for...in bot.guildInfo` → `for (const [guildId, info] of bot.getAllGuildInfo())`
   - 主要影響檔案預估：`src/handlers/commands/**`（registries、權限檢查）、`src/bot/client-event-bridge.ts`、`src/bot/guild-onboarding.ts`、`src/handlers/require-guild-repos.ts`。TS strict mode 會把所有殘留點亮出來，不靠 grep 也可完整定位。
   - `test/` 內以 mock 方式構造 BaseBot 的 fixture 一併更新（多半位於 [test/integration/bot/](../test/integration/bot/) 與 [test/unit/handlers/](../test/unit/handlers/)）。

   **不留 deprecation alias**——v1.0.0 為首次公開發行，無外部既存使用者，舊欄位直接移除；不在 BaseBot 上保留 `get guildInfo()` 的相容性 getter（避免兩套 API 並存增加維護面）。

   **`CHANGELOG.md` 紀錄**——於 `v1.0.0` 條目以「Initial public release」框架描述當下 API 即可；不需特別標註 breaking，因不存在「之前的公開版本」。

   **測試**——新增 `test/unit/bot/guild-info-accessors.test.ts`，覆蓋三條 getter 的 hit / miss 路徑與唯讀型別簽章；既有 integration 測試依新 API 改寫。

   **預估規模**——約 15–25 個 callsite，集中於 `src/handlers/` 與 `src/bot/`；單一 PR 可完成。reviewer 派遣：architecture-reviewer（API 表面變動）+ type-system-reviewer（readonly 型別正確性）+ test-architect（測試覆蓋）。

### 4.2 防衛性審視（僅調查，不承諾修改）

下列項目在發行前再看一眼；若調查確認無問題，記錄判定後即可。

1. **`BaseBot` 644 行**（[src/bot/index.ts](../src/bot/index.ts)）——尚在專業範圍內但已接近邊界。候選抽出：IoC bootstrap 段（行 235–290 + `setupContainer`）改為 `BaseBotContainerBootstrap` collaborator。判定：除非檔案再長，否則維持現狀；記錄此門檻。
2. **`MongoConnectionManager` 496 行**（[src/infra/mongo/connection-manager.ts](../src/infra/mongo/connection-manager.ts)）——涵蓋連線、retry / backoff、降級、lifecycle。檢查各責任的測試是否覆蓋公開合約；若再長則拆出 retry policy。判定：v1.0.0 不動。
3. ~~`bot.guildInfo[guildId].repos` API 收斂~~——**已升至 §4.1 第 7 點，納入 v1.0.0 範圍**。
4. **`src/` 內三處 `any` 使用**——
   - [src/infra/llm/error-translator.ts:74](../src/infra/llm/error-translator.ts#L74) — 收斂外部 SDK 錯誤；合法。
   - [src/core/plugin/event-dispatcher.ts:76](../src/core/plugin/event-dispatcher.ts#L76) — 出現在註解內，非程式碼。
   - [src/plugins/llm-chat/plugin.ts:121](../src/plugins/llm-chat/plugin.ts#L121) — `type AnyLlmProviderError = LlmProviderError<any>` 作為 supertype；合法。確認無誤後可補上 `// eslint-disable-line @typescript-eslint/no-explicit-any` 與理由註解。
5. **`docs/wiki/components/` 內容漂移**——頁面於 R 工作期間由 `update-wiki` skill 更新，發行前掃一遍，確保描述當下行為而非歷史快照。

### 4.3 不在範圍內

- 不做架構重構。架構本身即為交付物。
- 不加新特性。
- 不升 dependency。發行後另開維運 PR 處理。
- 不擴充 i18n locale（維持現有 `zh-TW` + `en`）。

---

## 5. 風險與 rollback

| 風險                                                | 緩解                                                                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 文件改寫與程式碼行為脫節                            | `README.md` / `CONTRIBUTING.md` 中每項主張皆引用具體程式路徑，並對照 live tree 審視                                               |
| 刪除 `docs/design/` 流失設計理據                    | 將 load-bearing 理據蒸餾至 `docs/architecture.md`。R / D / G 對應表本身為內部使用，對使用者非 load-bearing                        |
| Branch 刪除不可逆                                   | 列為 merge 至 `main` 後最終步驟，並需明確再確認；確認前遠端 branch 不動                                                            |
| `package.json` `engines` 變更影響下游               | engines 維持 `>=22.13.0`；僅修正 `CONTRIBUTING.md` 文字                                                                            |
| GitHub Wiki 已有的外部連結因 `docs/wiki/` 改寫而斷  | `docs/wiki/` 落在 repo 內，同 PR 一併更新內部連結                                                                                  |

Rollback：所有變更皆為 branch 上的一般 git commit。無任何行為性改動會在缺乏對應測試通過的情況下提交。回滾以 `git revert <sha>` 即可。

---

## 6. 執行計畫（本 proposal 通過後）

依序排列，每步綠燈後再進下一步：

1. **刪除內部工程文件**（`docs/tasks/`、`docs/design/`、`docs/design.md`、`docs/codebase-review-2026-05.md`、`docs/revision.md`、舊版 `docs/proposal.md` 已由本文件覆寫、舊版 `docs/high-level-design.md`）。
2. **撰寫 `docs/architecture.md`**（取代 `high-level-design.md`）。
3. **重寫 `README.md`** 依 §3.4。
4. **重寫 `CONTRIBUTING.md`** 依 §3.5。
5. **重寫 `CLAUDE.md`** 依 §3.6。
6. **更新 `docs/wiki/Home.md` + `docs/wiki/CHANGELOG.md` + `docs/wiki/components/*.md`**。
7. **新增 `SECURITY.md`、`CODE_OF_CONDUCT.md`、`CHANGELOG.md`（根目錄）**。
8. **改寫 `.claude/` agents 與 skills** 依 §3.7——刪除 `tech-debt-orchestrator.md`、`r-implementer.md`、`r-task-workflow` skill；改寫六個 reviewer agents 與三個保留 skills；新增 `contribute-change` skill 與 `change-implementer` agent。
9. **執行 §4.1 程式碼清理**（含第 7 項 `BaseBot.guildInfo` 收斂為唯讀 API 的全 callsite 遷移與測試更新）。
10. **跑完整 quality-gate suite**（`yarn typecheck && yarn lint && yarn test && yarn format:check && yarn handlers:gen:check && yarn knip && yarn security`），全綠。
11. **將 `refactor/architecture-overhaul` 合併至 `main` 作為 v1.0.0**，打 release tag。
12. **刪除過時 branches**（§3.8），於明確再確認後執行。

每個步驟為獨立 commit；步驟 1–8 可由審閱者裁量併入單一 PR 或拆為小 PR 序列。

---

## 7. 決議事項

審閱階段已確認的決定：

| 項目                          | 決議                                                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `package.json` `author`       | **維持** `"ACaccel, rbt4168"`，不於 v1.0.0 更動                                                                              |
| `SECURITY.md` 通報管道        | **採 GitHub Security Advisory（GHSA）**——於 SECURITY.md 提供 GHSA 開單連結與 72 小時初步回應 / 90 天責任揭露時程             |
| 是否發佈至 npm                | **不發佈**——`package.json` 維持 `"private": true`，發行型態僅為 GitHub source release + git tag                              |
| Voice + ffmpeg 拆 optional peer | **延後**——v1.0.0 不動 `dependencies`；列入發行後待辦，於下一個 minor 評估                                                 |
| 公開文件語言                  | **頂層文件統一英文**——`README.md` / `CONTRIBUTING.md` / `CLAUDE.md` / `docs/architecture.md` / `SECURITY.md` / `CODE_OF_CONDUCT.md` / `CHANGELOG.md` / `docs/wiki/**` / `.claude/agents/**` / `.claude/skills/**` 皆英文撰寫；不維護中文鏡像 |

i18n catalog（`src/i18n/locales/zh-TW/`、`en/`）為**程式產品內容**而非文件，仍維持雙語並由 i18n parity gate 把關，不在「文件統一英文」範圍內。
