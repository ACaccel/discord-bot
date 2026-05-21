import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'node-schedule';

import { JobManager } from '../../../../src/core/scheduling';

// `JobManager` is a keyed wrapper around `node-schedule`. The scheduler
// itself is mocked so the tests stay deterministic and never register a
// real timer.
const scheduleJobMock = vi.fn();
vi.mock('node-schedule', () => ({
  default: {
    scheduleJob: (...args: unknown[]) => scheduleJobMock(...args),
  },
}));

/** Build a minimal fake `Job` whose `cancel()` can be asserted on. */
const fakeJob = (): Job => ({ cancel: vi.fn() }) as unknown as Job;

afterEach(() => {
  scheduleJobMock.mockReset();
});

describe('JobManager', () => {
  it('schedules a job, stores it under the key and returns it', () => {
    const job = fakeJob();
    scheduleJobMock.mockReturnValue(job);
    const jobs = new Map<string, Job>();
    const manager = new JobManager(jobs);
    const date = new Date('2030-01-01T00:00:00Z');
    const callback = () => undefined;

    const result = manager.schedule('giveaway:1', date, callback);

    expect(result).toBe(job);
    expect(scheduleJobMock).toHaveBeenCalledWith(date, callback);
    expect(jobs.get('giveaway:1')).toBe(job);
  });

  it('replaces an existing job registered under the same key', () => {
    const first = fakeJob();
    const second = fakeJob();
    const jobs = new Map<string, Job>();
    const manager = new JobManager(jobs);

    scheduleJobMock.mockReturnValueOnce(first);
    manager.schedule('k', new Date(), () => undefined);
    scheduleJobMock.mockReturnValueOnce(second);
    manager.schedule('k', new Date(), () => undefined);

    expect(jobs.get('k')).toBe(second);
  });

  it('cancels a stored job, removes it and reports success', () => {
    const job = fakeJob();
    const jobs = new Map<string, Job>([['k', job]]);
    const manager = new JobManager(jobs);

    const cancelled = manager.cancel('k');

    expect(cancelled).toBe(true);
    expect(job.cancel).toHaveBeenCalledTimes(1);
    expect(jobs.has('k')).toBe(false);
  });

  it('returns false when cancelling an unknown key', () => {
    const manager = new JobManager(new Map<string, Job>());

    expect(manager.cancel('missing')).toBe(false);
  });

  it('exposes get / has for stored jobs', () => {
    const job = fakeJob();
    const jobs = new Map<string, Job>([['k', job]]);
    const manager = new JobManager(jobs);

    expect(manager.get('k')).toBe(job);
    expect(manager.has('k')).toBe(true);
    expect(manager.get('absent')).toBeUndefined();
    expect(manager.has('absent')).toBe(false);
  });
});
