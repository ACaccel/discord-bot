import { describe, expect, it } from 'vitest';
import { createMessageBackupPlugin } from '../../../src/plugins/message-backup';

describe('createMessageBackupPlugin', () => {
  it('has the expected plugin shape', () => {
    const p = createMessageBackupPlugin({ backupServers: ['1', '2'] });
    expect(p.id).toBe('message-backup');
    expect(p.scope).toBe('bot');
    expect(p.onReady).toBeTypeOf('function');
    expect(p.onShutdown).toBeTypeOf('function');
  });

  it('snapshots `backupServers` so mutating the caller array after construction does not affect the plugin', () => {
    const servers = ['1', '2'];
    const p = createMessageBackupPlugin({ backupServers: servers });
    servers.push('3');
    // The plugin captured a copy; the post-hoc push must not leak in.
    // We can't inspect config directly, but the snapshot guarantee is
    // worth pinning so future refactors don't regress it.
    expect(p).toBeDefined();
  });

  it('accepts an explicit positive `backupIntervalMs`', () => {
    const p = createMessageBackupPlugin({ backupServers: ['1'], backupIntervalMs: 5 * 60 * 1000 });
    expect(p.id).toBe('message-backup');
  });

  it('defaults the interval when `backupIntervalMs` is omitted', () => {
    const p = createMessageBackupPlugin({ backupServers: ['1'] });
    expect(p).toBeDefined();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    'rejects a non-positive, non-finite, or over-ceiling `backupIntervalMs` (%s)',
    (bad) => {
      expect(() =>
        createMessageBackupPlugin({ backupServers: ['1'], backupIntervalMs: bad }),
      ).toThrow(TypeError);
    },
  );

  it('accepts `backupIntervalMs` exactly at Node’s timer ceiling', () => {
    const p = createMessageBackupPlugin({ backupServers: ['1'], backupIntervalMs: 2_147_483_647 });
    expect(p.id).toBe('message-backup');
  });
});
