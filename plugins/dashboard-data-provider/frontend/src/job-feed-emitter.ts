/**
 * Mock Job Feed Emitter
 *
 * Simulates a live job feed by:
 * 1. Registering as the job-feed:subscribe handler (returns fallback mode)
 * 2. Emitting mock job events via the event bus at regular intervals
 *
 * In a real provider plugin, this would be replaced by:
 * - An Ably channel publisher in the backend
 * - The subscribe handler returning the Ably channel name
 */

import {
  DASHBOARD_JOB_FEED_EVENT,
  DASHBOARD_JOB_FEED_EMIT_EVENT,
  type IEventBus,
  type JobFeedSubscribeResponse,
  type JobFeedEntry,
} from '@naap/plugin-sdk';
import { generateMockJob, mockInitialJobs } from './data/index.js';

/** Interval between simulated job events (ms) */
const EMIT_INTERVAL_MS = 3500;

/**
 * Register the mock job feed emitter on the event bus.
 *
 * @param eventBus - The shell event bus instance
 * @returns Cleanup function to call on plugin unmount
 */
export function registerMockJobFeedEmitter(eventBus: IEventBus): () => void {
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
  for (const job of mockInitialJobs) {
    eventBus.emit<JobFeedEntry>(DASHBOARD_JOB_FEED_EMIT_EVENT, job);
  }

  // Start emitting new jobs at regular intervals
  const intervalId = setInterval(() => {
    const job = generateMockJob();
    eventBus.emit<JobFeedEntry>(DASHBOARD_JOB_FEED_EMIT_EVENT, job);
  }, EMIT_INTERVAL_MS);

  // Return cleanup
  return () => {
    clearInterval(intervalId);
    unsubscribeHandler();
  };
}
