/**
 * @naap/livepeer-node-client
 *
 * Typed TypeScript client for go-livepeer HTTP APIs.
 * Three clients matching the three API surfaces:
 * - CliClient: CLI API port (localhost-only on real nodes)
 * - MediaClient: Media API port
 * - AIClient: AI Gateway/Orchestrator API
 */

export { LivepeerCliClient } from './clients/CliClient.js';
export { LivepeerMediaClient } from './clients/MediaClient.js';
export { LivepeerAIClient } from './clients/AIClient.js';
export type {
  NodeStatus,
  OrchestratorInfo,
  Transcoder,
  Delegator,
  UnbondingLock,
  SenderInfo,
  ProtocolParameters,
  RoundInfo,
  TxResult,
  ContractAddresses,
  NetworkCapabilities,
  Capability,
} from './types.js';
