/**
 * Unit suite for the `drop-todo` command. Covers the options schema
 * (notably the dry-run-by-default safety) and command metadata; the Mongo
 * lifecycle is verified by manual runs against a real cluster.
 */
import { describe, expect, it } from 'vitest';

import { dropTodoCommand, dropTodoOptionsSchema, TODOS_COLLECTION } from './drop-todo';

describe('drop-todo / options schema', () => {
  it('defaults dry_run to true so an unconfigured run never deletes data', () => {
    expect(dropTodoOptionsSchema.parse({})).toEqual({ dry_run: true });
  });

  it('honours an explicit dry_run=false', () => {
    expect(dropTodoOptionsSchema.parse({ dry_run: false })).toEqual({ dry_run: false });
  });

  it('rejects a non-boolean dry_run', () => {
    expect(dropTodoOptionsSchema.safeParse({ dry_run: 'yes' }).success).toBe(false);
  });
});

describe('drop-todo / metadata', () => {
  it('targets the todos collection', () => {
    expect(TODOS_COLLECTION).toBe('todos');
  });

  it('exposes the expected command name', () => {
    expect(dropTodoCommand.name).toBe('drop-todo');
  });
});
