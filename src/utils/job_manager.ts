import { Job } from 'node-schedule';
import schedule from 'node-schedule';

export class JobManager {
    constructor(private readonly jobs: Map<string, Job>) {}

    /**
     * Schedule a job to run at the specified time and store it in the Map with the given key.
     */
    schedule(key: string, date: Date, callback: () => void | Promise<unknown>): Job {
        const job = schedule.scheduleJob(date, callback);
        this.jobs.set(key, job);
        return job;
    }

    /**
     * Cancel a job by its key and remove it from the Map. Returns true if the job was found and cancelled.
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

    get(key: string): Job | undefined {
        return this.jobs.get(key);
    }

    has(key: string): boolean {
        return this.jobs.has(key);
    }
}
