/**
 * Unit suite for the `drop-xfeed` command. Covers the options schema
 * (notably the dry-run-by-default safety) and command metadata; the Mongo
 * lifecycle is verified by manual runs against a real cluster.
 */
import { describe, expect, it } from 'vitest';

import { dropXfeedCommand, dropXfeedOptionsSchema, XFEED_CURSORS_COLLECTION } from './drop-xfeed';

describe('drop-xfeed / options schema', () => {
  it('defaults dry_run to true so an unconfigured run never deletes data', () => {
    expect(dropXfeedOptionsSchema.parse({})).toEqual({ dry_run: true });
  });

  it('honours an explicit dry_run=false', () => {
    expect(dropXfeedOptionsSchema.parse({ dry_run: false })).toEqual({ dry_run: false });
  });

  it('rejects a non-boolean dry_run', () => {
    expect(dropXfeedOptionsSchema.safeParse({ dry_run: 'yes' }).success).toBe(false);
  });
});

describe('drop-xfeed / metadata', () => {
  it('targets the retired xfeedcursors collection', () => {
    expect(XFEED_CURSORS_COLLECTION).toBe('xfeedcursors');
  });

  it('exposes the expected command name', () => {
    expect(dropXfeedCommand.name).toBe('drop-xfeed');
  });
});
