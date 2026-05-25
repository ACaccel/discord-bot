// AUTO-GENERATED — do not edit. Source: scripts/gen-registry.ts
// Run `yarn handlers:gen` after adding, renaming, or removing a handler
// subdirectory; CI verifies this file matches the on-disk layout via
// `yarn handlers:gen:check`.

import type { ModalHandler } from '.';
import { default as Handler_0 } from './ai_settings';
export const MODAL_REGISTRY = {
  ai_settings: Handler_0,
} as const satisfies Readonly<Record<string, new () => ModalHandler>>;
