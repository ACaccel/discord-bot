/**
 * `TodoRepo` — guild-scoped to-do list. The legacy handler treats
 * `content` as a soft-unique key (it pre-checks via `findByContent`
 * before insert) and addresses entries by 1-based position when
 * deleting — list ordering therefore matters.
 */
import type { GuildConnection } from '../../infra/mongo/connection-manager';
import type { TodoDoc } from '../schemas/todo.schema';

export interface TodoRepo {
  /** All to-dos in insertion order — the legacy handler addresses by 1-based index. */
  listAll(): Promise<readonly TodoDoc[]>;
  /** Find existing entries with this exact content (used to dedupe). */
  findByContent(content: string): Promise<readonly TodoDoc[]>;
  /** Persist a new to-do; returns the created doc. */
  create(content: string): Promise<TodoDoc>;
  /**
   * Delete the first to-do matching `content`. Returns true when a
   * document was removed; false when no match existed.
   */
  deleteByContent(content: string): Promise<boolean>;
}

export class MongoTodoRepo implements TodoRepo {
  constructor(private readonly conn: GuildConnection) {}

  public async listAll(): Promise<readonly TodoDoc[]> {
    return this.conn.models.Todo.find({}).lean<TodoDoc[]>().exec();
  }

  public async findByContent(content: string): Promise<readonly TodoDoc[]> {
    return this.conn.models.Todo.find({ content }).lean<TodoDoc[]>().exec();
  }

  public async create(content: string): Promise<TodoDoc> {
    const created = await this.conn.models.Todo.create({ content });
    return created.toObject<TodoDoc>();
  }

  public async deleteByContent(content: string): Promise<boolean> {
    const res = await this.conn.models.Todo.deleteOne({ content }).exec();
    return res.deletedCount > 0;
  }
}
