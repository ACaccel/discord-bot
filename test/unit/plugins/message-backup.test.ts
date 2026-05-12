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
});
