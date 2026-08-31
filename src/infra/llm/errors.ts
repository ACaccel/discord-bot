/**
 * Params-erased {@link LlmProviderError} alias.
 *
 * `LlmProviderError` is generic over its `messageParams` shape so each
 * translation branch can type its own interpolation bag. Past the
 * `LLMService.chat` boundary that narrowing is worthless: handlers read
 * `messageKey` + `messageParams` as an untyped i18n bag. Erasing the
 * generic once, here, keeps every downstream signature a single
 * concrete type instead of forcing each call site to re-widen (or to
 * reach for `any`).
 */
import type { LlmProviderError } from '../../core/errors';

export type AnyLlmProviderError = LlmProviderError<Readonly<Record<string, string | number>>>;
