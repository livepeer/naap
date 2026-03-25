/**
 * Job Feed Emitter — registerJobFeedEmitter
 *
 * Registers the job-feed:subscribe handler on the event bus. Does NOT emit
 * mock data — the live job feed only populates when real data is hooked up
 * (e.g. Kafka → base-svc → Ably or event bus from gateways).
 */

import {
  DASHBOARD_JOB_FEED_EVENT,
  type IEventBus,
  type JobFeedSubscribeResponse,
} from '@naap/plugin-sdk';

/**
 * Register the job feed subscription handler. No mock events are emitted.
 *
 * @param eventBus - The shell event bus instance
 * @returns Cleanup function to call on plugin unmount
 */
export function registerJobFeedEmitter(eventBus: IEventBus): () => void {
  const unsubscribeHandler = eventBus.handleRequest<undefined, JobFeedSubscribeResponse>(
    DASHBOARD_JOB_FEED_EVENT,
    async () => ({
      channelName: null,
      eventName: 'job',
      useEventBusFallback: true,
      fetchUrl: '/api/v1/dashboard/job-feed',
    })
  );

  return () => {
    unsubscribeHandler();
  };
}
