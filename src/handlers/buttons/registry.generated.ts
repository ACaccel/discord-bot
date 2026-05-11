// AUTO-GENERATED — do not edit. Source: scripts/gen-registry.ts
// Run `yarn handlers:gen` after adding, renaming, or removing a handler
// subdirectory; CI verifies this file matches the on-disk layout via
// `yarn handlers:gen:check`.

import type { ButtonHandler } from '.';
import { default as Handler_0 } from './toggle_role';
export const BUTTON_REGISTRY = {
  toggle_role: Handler_0,
} as const satisfies Readonly<Record<string, new () => ButtonHandler>>;
