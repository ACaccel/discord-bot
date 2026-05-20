# C6 — Handlers

> 路徑：`src/handlers/` ｜詳細設計：[`docs/design/C6-handlers.md`](../../design/C6-handlers.md) ｜任務：[`docs/tasks/C6-handlers.md`](../../tasks/C6-handlers.md)

## 職責

Discord interaction 進入點，一資料夾對應一 command/button/modal/select-menu/reaction，經 codegen 註冊。

## 現況

待辦：D5 — `requireGuildRepos` 改讀 `ConnectionManager.isDisabled`；D7 — 指令 metadata 去 CJK literal；D9 — `replyForError` 依錯誤型別回覆。

## 近期變更

- 2026-05-21 — 建立元件 wiki 頁（工程基礎建設）。
