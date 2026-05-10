'use strict';

/**
 * SchedulerService
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for ALL cron jobs. Replaces every n8n scheduleTrigger
 * node. Any new periodic job gets added to JOB_REGISTRY — nowhere else.
 *
 * Registered jobs
 * ┌─────────────────┬──────────────┬────────────────────────────────────────────┐
 * │ Name            │ Cron (LON)   │ Replaces                                   │
 * ├─────────────────┼──────────────┼────────────────────────────────────────────┤
 * │ lead-discovery  │ 06:00 daily  │ VenueDesk — Lead Discovery (Daily)         │
 * │ billing-cycle   │ 08:00 daily  │ VenueDesk — Billing Cycle Daily Trigger    │
 * │ balance-due     │ 08:30 daily  │ (new) confirmed_bookings overdue check      │
 * │ ai-analysis     │ 09:00 daily  │ VenueDesk — AI Lead Generator (Daily)      │
 * └─────────────────┴──────────────┴────────────────────────────────────────────┘
 *
 * All jobs:
 *   - Write a structured entry to bookings.system_logs on start, finish, and failure.
 *   - Run source = 'SchedulerService' on every entry so the health query works:
 *       SELECT * FROM bookings.system_logs WHERE source = 'SchedulerService';
 *   - Never re-throw — a failed job does not crash the process.
 *   - Are individually triggerable via POST /admin/run-job (returns 202 immediately).
 */

const cron           = require('node-cron');
const logger         = require('./LoggerService');
const { elapsedSec } = require('../utils/format');

// ── Lazy requires — avoid circular dependency issues at module load ───────────
const svc = {
  leadDiscovery: () => require('./LeadDiscoveryService'),
  billing:       () => require('./BillingService'),
};

// ── JOB_REGISTRY — single source of truth ────────────────────────────────────
// name         : identifier used by runManual() and the admin route
// expression   : 5-field cron in Europe/London time
// description  : shown in admin/logs and system_logs detail
// handler      : async function to invoke — must never throw (errors are caught)
// ─────────────────────────────────────────────────────────────────────────────
const JOB_REGISTRY = [
  {
    name:        'lead-discovery',
    expression:  '0 6 * * *',
    description: 'Google Places scrape — rotates county daily, deduplicates on insert',
    handler:     () => svc.leadDiscovery().runDiscovery(),
  },
  {
    name:        'billing-cycle',
    expression:  '0 8 * * *',
    description: 'Recurring payment schedule — create outstanding_payment rows and send reminders',
    handler:     () => svc.billing().runBillingCycle(),
  },
  {
    name:        'balance-due',
    expression:  '30 8 * * *',
    description: 'Overdue balance check — confirmed_bookings and recurring_series where balance_due > 0 and event date passed',
    handler:     () => svc.billing().runOverdueBalanceCheck(),
  },
  {
    name:        'ai-analysis',
    expression:  '0 9 * * *',
    description: 'AI lead scoring (OpenAI) and follow-up email sends',
    handler:     () => svc.leadDiscovery().runAnalysis(),
  },
];

// Indexed for O(1) lookup in runManual()
const JOB_BY_NAME = Object.fromEntries(JOB_REGISTRY.map(j => [j.name, j]));

// ─────────────────────────────────────────────────────────────────────────────

class SchedulerService {
  constructor() {
    /** @type {Map<string, import('node-cron').ScheduledTask>} */
    this._tasks = new Map();
  }

  /**
   * Register and start all jobs in JOB_REGISTRY.
   * Called once at server boot, after DB migrations complete.
   */
  start() {
    for (const job of JOB_REGISTRY) {
      this._register(job);
    }

    // Log the full registry to system_logs so the first health query is useful
    // even before any job has run.
    logger.info('SchedulerService', `Scheduler started — ${this._tasks.size} jobs registered`, {
      jobs: JOB_REGISTRY.map(j => ({
        name:       j.name,
        expression: j.expression,
        description: j.description,
      })),
    });
  }

  /**
   * Gracefully stop all running tasks.
   * Called on SIGTERM / SIGINT from server.js.
   */
  stop() {
    for (const [name, task] of this._tasks) {
      task.stop();
    }
    const stopped = [...this._tasks.keys()];
    this._tasks.clear();
    logger.info('SchedulerService', `Scheduler stopped`, { stoppedJobs: stopped });
  }

  /**
   * Return a snapshot of all registered jobs and their status.
   * Used by GET /admin/jobs.
   */
  listJobs() {
    return JOB_REGISTRY.map(j => ({
      name:        j.name,
      expression:  j.expression,
      description: j.description,
      registered:  this._tasks.has(j.name),
    }));
  }

  /**
   * Manually trigger a job by name.
   * Returns { queued: true } immediately — job executes asynchronously.
   * The full run result is visible in bookings.system_logs.
   *
   * @param {string} jobName  Must exist in JOB_REGISTRY
   */
  async runManual(jobName) {
    const job = JOB_BY_NAME[jobName];
    if (!job) {
      const valid = JOB_REGISTRY.map(j => j.name).join(', ');
      const err   = new Error(`Unknown job: "${jobName}". Valid jobs: ${valid}`);
      err.statusCode = 400;
      throw err;
    }

    // Fire the job in the next event-loop tick so the HTTP response is sent first.
    setImmediate(() => this._execute(job, 'manual'));

    return { queued: true, job: jobName, description: job.description };
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /**
   * Register a single job entry from JOB_REGISTRY.
   * Validates the cron expression before scheduling.
   */
  _register(job) {
    if (!cron.validate(job.expression)) {
      // This is a programmer error — fail fast at boot, not silently at runtime.
      throw new Error(
        `[SchedulerService] Invalid cron expression for "${job.name}": ${job.expression}`
      );
    }

    const task = cron.schedule(
      job.expression,
      () => this._execute(job, 'cron'),
      { timezone: 'Europe/London' }
    );

    this._tasks.set(job.name, task);
  }

  /**
   * Execute a job and write structured start/finish/error entries to system_logs.
   * All entries use source = 'SchedulerService' so they are queryable together.
   *
   * @param {{ name: string, description: string, handler: () => Promise<void> }} job
   * @param {'cron'|'manual'} triggeredBy
   */
  async _execute(job, triggeredBy) {
    const t0 = Date.now();

    // ── Start entry ──────────────────────────────────────────────────────────
    await logger.info('SchedulerService', `Job started: ${job.name}`, {
      job:         job.name,
      triggeredBy,
      description: job.description,
    });

    try {
      await job.handler();

      // ── Success entry ────────────────────────────────────────────────────
      // This is the entry that satisfies Task 3:
      //   SELECT * FROM bookings.system_logs
      //   WHERE  source = 'SchedulerService'
      //   AND    message LIKE 'Job finished:%'
      //   ORDER  BY created_at DESC;
      await logger.info('SchedulerService', `Job finished: ${job.name}`, {
        job:         job.name,
        triggeredBy,
        elapsed:     elapsedSec(t0),
        status:      'success',
      });

    } catch (err) {
      // ── Failure entry ────────────────────────────────────────────────────
      await logger.error('SchedulerService', `Job failed: ${job.name}`, {
        job:         job.name,
        triggeredBy,
        elapsed:     elapsedSec(t0),
        status:      'error',
        error:       err.message,
        stack:       err.stack,
      });
      // Never re-throw — keeps the cron alive for the next scheduled tick.
    }
  }
}

module.exports = new SchedulerService();
