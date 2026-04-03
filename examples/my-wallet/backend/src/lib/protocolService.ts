/**
 * Protocol params — delegates to live subgraph via livepeer.ts
 */

import { getProtocol, type ProtocolData } from './livepeer.js';

export { type ProtocolData };

export async function getProtocolParams(): Promise<ProtocolData> {
  return getProtocol();
}
