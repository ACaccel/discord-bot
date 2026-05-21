import type { Job } from 'node-schedule';
import schedule from 'node-schedule';

/**
 * Keyed wrapper around `node-schedule` that owns the lifecycle of a set
 * of scheduled jobs.
 *
 * Lives in `core/` because it is pure infrastructure: it depends only on
 * `node-schedule` and has no Discord / Mongo coupling. Both the giveaway
 * and activity plugins schedule deferred work, so the wrapper is shared
 * here rather than living inside a single plugin's `internal/`.
 *
 * The job `Map` is supplied by the caller so the plugin can keep its own
 * persistent job registry; `JobManager` is a thin stateless view over it.
 */
export class JobManager {
  constructor(private readonly jobs: Map<string, Job>) {}

  /**
   * Schedule a job to run at the specified time and store it in the map
   * under `key`, replacing any previously stored job for that key.
   */
  schedule(key: string, date: Date, callback: () => void | Promise<unknown>): Job {
    const job = schedule.scheduleJob(date, callback);
    this.jobs.set(key, job);
    return job;
  }

  /**
   * Cancel a job by its key and remove it from the map.
   *
   * @returns `true` if a job existed for `key` and was cancelled.
   */
  cancel(key: string): boolean {
    const job = this.jobs.get(key);
    if (job) {
      job.cancel();
      this.jobs.delete(key);
      return true;
    }
    return false;
  }

  /** Look up the job currently registered under `key`, if any. */
  get(key: string): Job | undefined {
    return this.jobs.get(key);
  }

  /** Report whether a job is registered under `key`. */
  has(key: string): boolean {
    return this.jobs.has(key);
  }
}
