/**
 * Vitest global setup for the integration project (Phase 0 placeholder).
 *
 * Phase 2 will start a single mongodb-memory-server here and expose its
 * URI via an environment variable; teardown stops it. This file is wired
 * into vitest.config.ts now so the project boundary is real — the
 * integration test directory exists and the setup file is loaded even
 * when zero integration tests are present yet, preventing a silent-pass
 * regression when Phase 2 starts adding tests.
 */
export const setup = async (): Promise<void> => {
  // Phase 2 populates this.
};

export const teardown = async (): Promise<void> => {
  // Phase 2 populates this.
};
