/**
 * Facade types not yet in @naap/plugin-sdk.
 *
 * Add types here as new data domains are added to the facade.
 * When a type matures it can be promoted to @naap/plugin-sdk.
 */

export type { NetworkModel } from '@naap/plugin-sdk';

/** Single entry in the live job feed — from NAAP API /v1/streams/samples */
export interface JobFeedItem {
  id: string;
  pipeline: string;
  model?: string;
  gateway: string;
  orchestratorUrl: string;
  state: string;
  inputFps: number;
  outputFps: number;
  firstSeen: string;
  lastSeen: string;
  /** Not available from the samples endpoint — omit to show '—' in the UI. */
  durationSeconds?: number;
  /** Not available from the samples endpoint — omit to show '—' in the UI. */
  runningFor?: string;
}
