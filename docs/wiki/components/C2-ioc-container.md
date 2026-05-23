# C2 — IoC Container

> 路徑：`src/core/ioc/` ｜詳細設計：[`docs/design/C2-ioc-container.md`](../../design/C2-ioc-container.md) ｜任務：[`docs/tasks/C2-ioc-container.md`](../../tasks/C2-ioc-container.md)

## 職責

約 280 行手寫 IoC 容器，以 `ServiceToken<T>` 型別化管理依賴生命週期，取代 Service Locator。

## 現況

設計檔判定無偏差。無缺口收斂任務。

## 現況補充（R2 後）

- `tokens.ts` 新增 `TOKENS.VoiceController` / `TOKENS.ModelCatalog`，
  分別由 `VoicePlugin` / `LlmChatPlugin` 在 `init` 階段透過
  `PluginInitContext.registerInstance` 註冊；BaseBot 的 `voice` /
  `modelCatalog` getter 經 `tryResolve` 取得。
- 容器公開 API 未變動：`registerInstance` 為 plugin host 的 facade，
  內部仍走既有的 `registerSingleton(token, () => instance)`，
  `DuplicateRegistrationError` 自動承襲。

## 近期變更

- 2026-05-24 — R2：新增 `VoiceController` / `ModelCatalog` 兩個 token，
  作為 `PluginInitContext.registerInstance` 取代 `let active*` 旁路後的
  唯一接線點 (tech-debt R2)
- 2026-05-21 — 建立元件 wiki 頁（工程基礎建設）。
