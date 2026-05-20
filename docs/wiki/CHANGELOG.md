# Wiki 變更日誌

倒序記錄（最新在上）。每次程式碼 / 文件的結構性變更由
[`update-wiki`](../../.claude/skills/update-wiki/SKILL.md) skill 追加一筆。

---

## 2026-05-21 — C5 D5 落地（`ConnectionManager` retry / 降級分類）

- **元件**：C5 Infra Adapters
- **缺口**：D5（方案 A）
- **變更**：`ConnectionManager`（`MongoConnectionManager` /
  `StaticConnectionManager`）內建 transient/persistent 降級。新增
  `isTransient(error: DatabaseError)` helper 於
  `src/persistence/error-translator.ts`（依 `DATABASE_TIMEOUT` /
  `DATABASE_NETWORK` sub-code 判定）。`getConnection` 對 transient 失敗做
  有上限的指數退避重試（`RetryPolicy`：預設 3 次 / 200ms / 2s 上限,
  建構子可注入；`SleepFn` 可注入使測試零等待）;重試耗盡或 persistent
  失敗則把 `guildId` 標記 disabled、自行生成 `traceId`、寫一行 operator
  stderr。新增 `isDisabled(guildId): DisabledGuildState | undefined` 對外
  可查;disabled 後 `getConnection` 短路丟同一 `DatabaseError`,
  `close` / `closeAll` 清除 marker。retry 迴圈抽為共用 `retryOpen` free
  function,兩個 manager 共用同一韌性實作。`BaseBot` 退化為查詢端：移除
  自持的 `disabledGuilds` map 與 `connectOneGuild` 的 catch-記錄寫入,
  `disabledGuilds` 改為投影 `ConnectionManager.isDisabled` 的唯讀 getter。
- **影響**：四個 bot 對外行為等價——壞 URI 的 guild 仍最終 disabled、
  handler 經 `requireGuildRepos` 回 `errors:db.guild_disabled` 附
  `traceId`,差異僅在 transient 失敗多了重試、`traceId` 改由
  `ConnectionManager` 生成。per-URI 共用語意：共用同一 base URI 的 bot
  共用同一 `disabled` set。`requireGuildRepos`（C6 D5）與 `BaseBot` 完整
  退化（C11 D5）的讀取來源收斂為後續任務。

## 2026-05-21 — C4 G-2 落地（repository 邊界 `Result` 一致性）

- **元件**：C4 Persistence
- **缺口**：G-2
- **變更**：七個 repository 邊界（activity / fetch / giveaway / message /
  reply / todo / user-api-setting）統一改回 `Result<T, DatabaseError>`：
  介面方法簽章與 `MongoXRepo` 實作以 try/catch 包裹 mongoose 呼叫,錯誤經
  `databaseErrorFrom` 包成 `err(DatabaseError)`,成功回 `ok(...)`,查無資料
  為 `ok(undefined)`。mongoose error-translator 自
  `src/infra/mongo/error-translator.ts` 搬至
  `src/persistence/error-translator.ts`,使七個 repo 無須反向 import
  `infra/mongo`。所有 repo callsite（handler / plugin 委派邏輯）改以
  `result.ok` 判斷,`err` 重擲入既有 catch。各 repo integration test 補
  `err(DatabaseError)` 路徑覆蓋,error-translator 單元測試移至
  `test/unit/persistence/`。HLD §7.2、C4 設計檔 §7 與實作對齊。
- **影響**：repository 公開介面簽章變更（回傳型別包上 `Result`）;程式員
  錯誤仍走 `TypeError`,不進 `Result`。四個 bot 對外行為等價——`err` 在
  callsite 重擲後走原本的 log + 失敗回覆路徑。

## 2026-05-21 — C7 D7 + D9 落地（雙語系 i18n catalog）

- **元件**：C7 i18n Catalog
- **缺口**：D7、D9
- **變更**：填 `zh-TW/commands.json` 指令 metadata key（描述 / 選項描述 /
  穩定 value choices）;新建 `src/interface/locales/en/{commands,errors,replies}.json`
  並把 `zh-TW` 全部 key 英譯。每個指令 feature 補有語氣的
  `replies:<feature>.failed` 回退文案,一律帶 `{{traceId}}` 內插位。新增
  `test/i18n/catalog-runtime.test.ts` 以實際載入管線驗證 en 解析、雙語系零缺
  key、缺 key 回退。C7 設計檔與 `CONTRIBUTING.md` 明示雙語系維護負擔。
- **影響**：catalog 新增 key（commands 命名空間、`en/` 語系、per-feature
  `failed` 回退）;handler 端去 literal 與 `replyForError` 屬 C6 範圍。
  `failed` 文案新增 `{{traceId}}` 屬 D9 明示的允許行為變更,其餘文案語意不變。

## 2026-05-21 — C10 D8 落地（strict tsconfig 涵蓋全 src）

- **元件**：C10 Quality Gates
- **缺口**：D8
- **變更**：`tsconfig.strict.json` 的 `include` 改為 `src/**/*`，並補入 path
  alias。掃除 `src/handlers/` 在 strict 模式下的 `noUncheckedIndexedAccess` /
  `noUnusedParameters` / 未使用 import 違規。
- **影響**：行為等價——handler 邏輯不變，僅補 narrowing 與移除死碼。

## 2026-05-21 — C8 D2（earthquake plugin）+ G-1 落地

- **元件**：C8 Plugins
- **缺口**：D2、G-1
- **變更**：新增 `src/plugins/earthquake/`——`createEarthquakePlugin` 工廠、
  `start` hook 內的 Express `/discord/earthquake` 路由、`internal/broadcast.ts`
  的 per-guild 廣播邏輯（自 legacy `events/earthquake.ts` 遷入）。giveaway /
  activity 的 `msgReact` 改用結構化 logger。
- **影響**：行為等價——地震廣播語意不變；`nijika` 仍經 legacy inline 路由（待 C11
  D2 切換後再移除 `events/earthquake.ts`）。

## 2026-05-21 — C3 D1 介面 + D6 落地

- **元件**：C3 Plugin Runtime
- **缺口**：D1（介面）、D6
- **變更**：新增 `src/core/plugin/guild-onboarding-port.ts`（`GuildOnboardingPort`
  介面）與 `TOKENS.GuildOnboardingPort`；抽出 `host/lifecycle.ts` 的
  `PluginLifecycleRunner`（經窄介面 `LifecycleHost` 注入）；`cascadeDisable`
  移入 `host/topology.ts` 成為純函式；`host.ts` 生命週期方法改為薄委派。
- **影響**：行為等價——生命週期執行語意不變，僅結構重組。

## 2026-05-21 — 補上 auto-merge reconciliation 規則

- **元件**：C10 Quality Gates / 工程團隊
- **缺口**：—
- **變更**：明確規範 auto-merge 非 fire-and-forget——check 失敗時 PR 會停在
  OPEN。`engineering-orchestrator` agent 新增「Auto-merge reconciliation」段落
  （追蹤待結 PR、依賴工作以 `MERGED` 為前置條件、失敗則 push 修正至同分支）；
  `CONTRIBUTING.md` 補上失敗 PR 的處理說明。
- **影響**：行為等價（無 `src/` 變更）。修正先前「派完 PR 即不理會」的不完整
  描述。

## 2026-05-21 — 啟用 auto-merge 為預設合併方式

- **元件**：C10 Quality Gates
- **缺口**：—
- **變更**：repo 啟用 GitHub auto-merge；定 `gh pr merge --auto --merge` 為
  預設合併方式。`CONTRIBUTING.md`、`docs/design/C10-quality-gates.md` §2.8、
  `engineering-orchestrator` agent 一併記載。
- **影響**：行為等價（無 `src/` 變更）。PR 排入 auto-merge 後，10 個 required
  check 全綠即由 GitHub 自動合併；auto-merge 不繞過 branch protection。

## 2026-05-21 — 設定 required status check

- **元件**：C10 Quality Gates
- **缺口**：—
- **變更**：為 `refactor/architecture-overhaul` 加上 branch protection，把全部
  10 個 CI job 設為 required status check（`strict: false`、不要求人工 review）。
  `CONTRIBUTING.md`「Quality gates」與 `docs/design/C10-quality-gates.md` §2.8
  記載此政策；並指出 `main` 的 protection 仍有過時 check 名稱待修正。
- **影響**：行為等價（無 `src/` 變更）。此後進 `refactor/architecture-overhaul`
  的 PR 須 10 個 CI 閘門全綠才能合併。

## 2026-05-21 — 補齊 session 銜接入口

- **元件**：工程基礎建設（非 C1–C11 任一）
- **缺口**：—
- **變更**：新增 `docs/tasks/README.md`（工程單一進入點）；`CLAUDE.md` 新增
  「Active engineering: gap-remediation」段落並更新 agent/skill 區塊；重寫
  `.claude/agents/` 6 個 reviewer 為現行架構（英文）；寫入專案 memory。
- **影響**：行為等價（無 `src/` 程式碼變更）。新 session 可從 `CLAUDE.md` →
  `docs/tasks/README.md` 無縫接手。

## 2026-05-21 — 建立工程子 agent 團隊與 skills

- **元件**：工程基礎建設（非 C1–C11 任一）
- **缺口**：—
- **變更**：新增 `.claude/agents/engineering-orchestrator.md`、
  `.claude/agents/component-implementer.md` 兩個工程 agent；填入
  `.claude/skills/{project-conventions,coding-standards,gap-task-workflow,update-wiki}/SKILL.md`
  四個 skill；建立 `docs/wiki/`（Home、CHANGELOG、11 個元件頁）。
- **影響**：行為等價（無 `src/` 程式碼變更）。建立缺口收斂工程的自主執行團隊
  與規範。

## 2026-05-20 — 建立缺口收斂任務劃分

- **元件**：—
- **缺口**：D1–D9、G-1、G-2
- **變更**：建立 `docs/tasks/`（11 個元件任務檔 + `progress.md`），把
  `docs/design/gaps.md` 的缺口按元件切分為 check list 子任務。
- **影響**：行為等價（純文件）。
