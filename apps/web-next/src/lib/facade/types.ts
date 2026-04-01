/**
 * Facade types not yet in @naap/plugin-sdk.
 *
 * Add types here as new data domains are added to the facade.
 * When a type matures it can be promoted to @naap/plugin-sdk.
 */

/** Live network model entry from NAAP_API_SERVER_URL/net/models */
export interface NetworkModel {
  Pipeline: string;
  Model: string;
  WarmOrchCount: number;
  TotalCapacity: number;
  PriceMinWeiPerPixel: number;
  PriceMaxWeiPerPixel: number;
  PriceAvgWeiPerPixel: number;
}

/** Single entry in the live job feed — from NAAP API /v1/streams/samples */
export interface JobFeedItem {
  id: string;
  pipeline: string;
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
