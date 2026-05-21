# Discord Bot — Repo Wiki

本 wiki 是 codebase 的活文件，由 [`update-wiki`](../../.claude/skills/update-wiki/SKILL.md)
skill 在每次程式碼 / 文件變更後自動同步。它描述**現況**；設計理由見
[`docs/design/`](../design/)，需求見 [`docs/proposal.md`](../proposal.md)。

## 專案概覽

TypeScript + Discord.js + MongoDB 的多人格 Discord 機器人 codebase，於單一
共用核心上託管 `nijika` / `konata` / `tomori` / `msg-archive` 四個 bot。架構為
Clean Architecture 分層 + Plugin 化（依賴單向：`bot → plugins → handlers →
infra → persistence → core`）。

目前進行中的工程：依 [`docs/design/gaps.md`](../design/gaps.md) 收斂 10 項
目標設計未落地缺口（D1–D9、G-1）+ 任務劃分新增的 G-2。**接手工程請從
[`docs/tasks/README.md`](../tasks/README.md) 開始**——它是工程的單一進入點。

## 元件頁

| 元件 | 名稱                  | 路徑                     | 頁面                                                                               |
| ---- | --------------------- | ------------------------ | ---------------------------------------------------------------------------------- |
| C1   | Core Infrastructure   | `src/core/`              | [components/C1-core-infrastructure.md](components/C1-core-infrastructure.md)       |
| C2   | IoC Container         | `src/core/ioc/`          | [components/C2-ioc-container.md](components/C2-ioc-container.md)                   |
| C3   | Plugin Runtime        | `src/core/plugin/`       | [components/C3-plugin-runtime.md](components/C3-plugin-runtime.md)                 |
| C4   | Persistence           | `src/persistence/`       | [components/C4-persistence.md](components/C4-persistence.md)                       |
| C5   | Infra Adapters        | `src/infra/`             | [components/C5-infra-adapters.md](components/C5-infra-adapters.md)                 |
| C6   | Handlers              | `src/handlers/`          | [components/C6-handlers.md](components/C6-handlers.md)                             |
| C7   | i18n Catalog          | `src/interface/locales/` | [components/C7-i18n-catalog.md](components/C7-i18n-catalog.md)                     |
| C8   | Plugins               | `src/plugins/`           | [components/C8-plugins.md](components/C8-plugins.md)                               |
| C9   | Codegen & Scripts     | `scripts/`               | [components/C9-codegen-scripts.md](components/C9-codegen-scripts.md)               |
| C10  | Quality Gates         | CI / 設定檔              | [components/C10-quality-gates.md](components/C10-quality-gates.md)                 |
| C11  | Bot Composition Roots | `src/bot/`               | [components/C11-bot-composition-roots.md](components/C11-bot-composition-roots.md) |

## 元件完成度

> 與 [`docs/tasks/progress.md`](../tasks/progress.md) §2 機械對齊。

| 元件 | 缺口收斂任務        | 狀態     |
| ---- | ------------------- | -------- |
| C1   | D4（條件性）        | ☐ 未完成 |
| C2   | 無收斂任務          | ☑ 已完成 |
| C3   | D1、D6              | ☑ 已完成 |
| C4   | G-2                 | ☑ 已完成 |
| C5   | D5                  | ☑ 已完成 |
| C6   | D5、D7、D9          | ☑ 已完成 |
| C7   | D7、D9              | ☑ 已完成 |
| C8   | D1、D2、D3、D4、G-1 | ☐ 未完成 |
| C9   | D4（條件性）        | ☐ 未完成 |
| C10  | D3、D8              | ☐ 未完成 |
| C11  | D1、D2、D4、D5      | ☐ 未完成 |

## 其他

- 工程進入點：[`docs/tasks/README.md`](../tasks/README.md)
- 變更日誌：[CHANGELOG.md](CHANGELOG.md)
- 工程團隊 agent：`.claude/agents/engineering-orchestrator.md`、`component-implementer.md`
- 規範 skill：`.claude/skills/{project-conventions,coding-standards,gap-task-workflow,update-wiki}/`
