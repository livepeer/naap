/**
 * Facade types not yet in @naap/plugin-sdk.
 *
 * Add types here as new data domains are added to the facade.
 * When a type matures it can be promoted to @naap/plugin-sdk.
 */

/** Live network model entry from LEADERBOARD_API_URL/net/models */
export interface NetworkModel {
  Pipeline: string;
  Model: string;
  WarmOrchCount: number;
  TotalCapacity: number;
  PriceMinWeiPerPixel: number;
  PriceMaxWeiPerPixel: number;
  PriceAvgWeiPerPixel: number;
}

/** Single entry in the live job feed (mirrors ActiveStreamRow from active-streams-clickhouse) */
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
  durationSeconds: number;
  runningFor: string;
}
