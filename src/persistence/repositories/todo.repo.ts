/**
 * `TodoRepo` — guild-scoped to-do list. The legacy handler treats
 * `content` as a soft-unique key (it pre-checks via `findByContent`
 * before insert) and addresses entries by 1-based position when
 * deleting — list ordering therefore matters.
 *
 * **Error boundary (gap G-2)**: every method returns
 * `Result<T, DatabaseError>`. A mongoose failure is translated by the
 * shared `databaseErrorFrom` translator and returned as `err`.
 */
import type { DatabaseError } from '../../core/errors/external-service-error';
import { err, ok, type Result } from '../../core/result';
import type { GuildConnection } from '../../infra/mongo/connection-manager';
import { databaseErrorFrom } from '../error-translator';
import type { TodoDoc } from '../schemas/todo.schema';

export interface TodoRepo {
  /** All to-dos in insertion order — the legacy handler addresses by 1-based index. */
  listAll(): Promise<Result<readonly TodoDoc[], DatabaseError>>;
  /** Find existing entries with this exact content (used to dedupe). */
  findByContent(content: string): Promise<Result<readonly TodoDoc[], DatabaseError>>;
  /** Persist a new to-do; returns the created doc. */
  create(content: string): Promise<Result<TodoDoc, DatabaseError>>;
  /**
   * Delete the first to-do matching `content`. `ok(true)` when a
   * document was removed; `ok(false)` when no match existed.
   */
  deleteByContent(content: string): Promise<Result<boolean, DatabaseError>>;
}

export class MongoTodoRepo implements TodoRepo {
  constructor(private readonly conn: GuildConnection) {}

  public async listAll(): Promise<Result<readonly TodoDoc[], DatabaseError>> {
    try {
      return ok(await this.conn.models.Todo.find({}).lean<TodoDoc[]>().exec());
    } catch (rawErr: unknown) {
      return err(databaseErrorFrom(rawErr, { operation: 'MongoTodoRepo.listAll' }));
    }
  }

  public async findByContent(content: string): Promise<Result<readonly TodoDoc[], DatabaseError>> {
    try {
      return ok(await this.conn.models.Todo.find({ content }).lean<TodoDoc[]>().exec());
    } catch (rawErr: unknown) {
      return err(
        databaseErrorFrom(rawErr, {
          operation: 'MongoTodoRepo.findByContent',
          input: { content },
        }),
      );
    }
  }

  public async create(content: string): Promise<Result<TodoDoc, DatabaseError>> {
    try {
      const created = await this.conn.models.Todo.create({ content });
      return ok(created.toObject<TodoDoc>());
    } catch (rawErr: unknown) {
      return err(
        databaseErrorFrom(rawErr, { operation: 'MongoTodoRepo.create', input: { content } }),
      );
    }
  }

  public async deleteByContent(content: string): Promise<Result<boolean, DatabaseError>> {
    try {
      const res = await this.conn.models.Todo.deleteOne({ content }).exec();
      return ok(res.deletedCount > 0);
    } catch (rawErr: unknown) {
      return err(
        databaseErrorFrom(rawErr, {
          operation: 'MongoTodoRepo.deleteByContent',
          input: { content },
        }),
      );
    }
  }
}
