/**
 * Job Feed Emitter — registerJobFeedEmitter
 *
 * Registers the job-feed:subscribe handler on the event bus and emits mock job
 * events at regular intervals. Simulates a live job feed for dashboard testing.
 *
 * In a real provider plugin, this would be replaced by an Ably channel
 * publisher in the backend and the subscribe handler returning the channel name.
 */

import {
  DASHBOARD_JOB_FEED_EVENT,
  DASHBOARD_JOB_FEED_EMIT_EVENT,
  type IEventBus,
  type JobFeedSubscribeResponse,
  type JobFeedEntry,
} from '@naap/plugin-sdk';
import { generateJob, seedJobs } from './data/index.js';

/** Interval between simulated job events (ms) */
const EMIT_INTERVAL_MS = 3500;

/**
 * Register the mock job feed emitter on the event bus.
 *
 * @param eventBus - The shell event bus instance
 * @returns Cleanup function to call on plugin unmount
 */
export function registerJobFeedEmitter(eventBus: IEventBus): () => void {
  // Register as the job feed subscription handler
  const unsubscribeHandler = eventBus.handleRequest<undefined, JobFeedSubscribeResponse>(
    DASHBOARD_JOB_FEED_EVENT,
    async () => ({
      channelName: null,
      eventName: 'job',
      useEventBusFallback: true,
    })
  );

  // Emit initial seed jobs so the dashboard isn't empty on first load
  for (const job of seedJobs) {
    eventBus.emit<JobFeedEntry>(DASHBOARD_JOB_FEED_EMIT_EVENT, job);
  }

  // Start emitting new jobs at regular intervals
  const intervalId = setInterval(() => {
    const job = generateJob();
    eventBus.emit<JobFeedEntry>(DASHBOARD_JOB_FEED_EMIT_EVENT, job);
  }, EMIT_INTERVAL_MS);

  // Return cleanup
  return () => {
    clearInterval(intervalId);
    unsubscribeHandler();
  };
}
