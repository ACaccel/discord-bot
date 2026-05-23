# C6 — Handlers

> 路徑：`src/handlers/` ｜詳細設計：[`docs/design/C6-handlers.md`](../../design/C6-handlers.md) ｜任務：[`docs/tasks/C6-handlers.md`](../../tasks/C6-handlers.md)

## 職責

Discord interaction 進入點,一資料夾對應一 command/button/modal/select-menu/reaction,經 codegen 註冊。

## 現況

D5、D7、D9 已收斂,並於 D4(`src/utils/` 退場)承接 handler 側工具:

- **D5（C6 切片）** — `requireGuildRepos` 的 disabled-guild 守衛改讀
  `bot.connectionManager?.isDisabled(...)`,不再經 `BaseBot.disabledGuilds`
  getter;`traceId` 直接取自 `ConnectionManager`。`BaseBot` 新增唯讀
  `connectionManager` getter(對齊 `translator`/`logger`/`env` 存取模式,
  使 handler 層免於 import IoC 容器)。
- **D7** — 指令 metadata 去 CJK literal:`CommandConfig.description` /
  `CommandOption.description` 改為由 `commands` 命名空間 catalog 解析;新增
  `localizeCommandConfig(config, translator)` 由命令/選項名稱推導 catalog key
  並回傳 `LocalizedCommandConfig`;`getCommandJsonBody` / `deploy.ts` /
  `help` 於 build 時解析。context-menu 指令的顯示名稱由 `commands:<id>.name`
  解析(`config.name` 改存穩定 ASCII id)。`change_avatar` / `random_restaurant`
  的 CJK-valued choices 移至 colocated JSON 資料檔(`identity.json` /
  `restaurant-types.json`);其餘 ASCII-valued choices 的 CJK 顯示名稱移入
  `commands.json` 的 `choices` key。`src/handlers/` 指令 metadata 已無
  `// i18n-ignore`,CJK scanner 對 `src/handlers` 零違規。
- **D9** — 新增 handler 邊界共用 helper `replyForError(interaction, bot,
error, fallbackKey, guildId?)`:operator 通道恆記結構化 log(完整錯誤 +
  `traceId`);user 通道對 `DomainError` 依 `messageKey` 回覆、對非
  `DomainError` 回退 per-feature 的 `replies:<feature>.failed` 並附 `traceId`。
  各 handler catch 改為單一 `replyForError(...)` 呼叫(`random_restaurant`
  保留其時段相關的專屬回退 UX)。
- **D4(C6 切片)** — `src/utils/` 退場後,handler 專用工具承接於
  `src/handlers/commands/`:`buildCommandJsonBody` 移入 `command-builder.ts`
  (經 `@cmd` barrel 再匯出,供 `deploy.ts` 與 runtime command 註冊共用);
  `buildButtonRows` / `msgReact` / `scheduleJob` / `listInOneImage` /
  `CanvasContent` / `CanvasOptions` 移入 `discord-helpers.ts`。`msgReact`
  改用注入的結構化 `Logger`,不再有 raw `console`。

## 公開介面

- `requireGuildRepos(bot, interaction): Promise<Repos | null>` — 三道守衛,
  disabled-guild 來源為 `ConnectionManager.isDisabled`。
- `replyForError(interaction, bot, error, fallbackKey, guildId?)` /
  `resolveErrorReply(translator, error, fallbackKey, traceId)` —
  `src/handlers/reply-for-error.ts`。
- `Command` / `CommandConfig` / `CommandOption` / `CommandChoice` /
  `LocalizedCommandConfig` / `localizeCommandConfig` —
  `src/handlers/commands/command.ts`(由 `@cmd` barrel 再匯出)。
- `buildCommandJsonBody(config)` — `src/handlers/commands/command-builder.ts`
  (由 `@cmd` barrel 再匯出)。
- `buildButtonRows` / `msgReact` / `scheduleJob` / `listInOneImage` /
  `CanvasContent` / `CanvasOptions` — `src/handlers/commands/discord-helpers.ts`。

## 近期變更

- 2026-05-24 — R6.3 / R6.5：5 個 handler barrel (`commands` / `buttons` /
  `modals` / `select-menus` / `reactions`) 重排為 `imports → re-exports →
body`；`commands` barrel 移除一段註解 `console.log(info/message/err)`
  死碼與一處 `console.log(hourTPE)`（改為 `bot.logger?.debug`）；
  `delete_reply` 60-line block-commented 死碼直接刪除 (tech-debt R6.3 / R6.5)
- 2026-05-24 — R4:4 個示範 handler 拆分 helper + 行數規範入文件。
  `db_list_message`(320→135 行)、`inspect_member_ids`(172→89 行)、
  `emoji_frequency`(158→121 行)、`ai_settings`(161→68 行)的 pure helper
  抽到同目錄 sibling 檔(`parse-range.ts` / `render-reactions.ts` /
  `sanitize-mentions.ts` / `chunk-output.ts` / `format-message-lines.ts` /
  `build-archive-attachment.ts` / `resolve-display-name.ts` /
  `parse-ids.ts` / `format-helpers.ts` / `format-member-fields.ts` /
  `clamp-options.ts` / `aggregate-emoji-counts.ts` / `rank-emoji.ts` /
  `format-leaderboard.ts` / `provider-choices.ts` /
  `validate-ai-settings.ts` / `build-settings-modal.ts`),每個 helper
  有對應 unit test 於 `test/unit/handlers/<name>/`。`index.ts` 僅留
  Discord I/O + 權限 + Translator + 回覆組裝。`parseStartEnd` 加上
  calendar range guard(month 1-12 / day 1-31)以提早 null,不改變對合法輸入
  的對外行為 (tech-debt R4)
- 2026-05-21 — D4(C6 切片):`src/utils/bot_cmd.ts` / `misc.ts` 的 handler 專用
  函式承接於 `command-builder.ts` 與 `discord-helpers.ts`(gap D4)。
- 2026-05-21 — D5/D7/D9 收斂:`requireGuildRepos` 改讀 `ConnectionManager`;
  指令 metadata 去 CJK literal + `localizeCommandConfig`;新增 `replyForError`
  錯誤邊界 helper。指令 metadata/型別自 `commands/index.ts` 抽至
  `commands/command.ts`(gap D5/D7/D9)。
- 2026-05-21 — 建立元件 wiki 頁(工程基礎建設)。
