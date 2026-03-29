export { AgentCoordinator } from './coordinator.js';
export { bookkeeperProfile } from './bookkeeper-agent.js';
export { taxStrategistProfile } from './tax-strategist-agent.js';
export { collectionsProfile } from './collections-agent.js';
export { insightsProfile } from './insights-agent.js';
export type { AgentId, AgentProfile, AgentMetrics, AgentConfig, AgentMessage } from './types.js';

import { AgentCoordinator } from './coordinator.js';
import { bookkeeperProfile } from './bookkeeper-agent.js';
import { taxStrategistProfile } from './tax-strategist-agent.js';
import { collectionsProfile } from './collections-agent.js';
import { insightsProfile } from './insights-agent.js';

/**
 * Initialize the multi-agent system with all 4 sub-agents.
 * Each agent gets a placeholder handler — wire to real skill execution in production.
 */
export function initMultiAgentSystem(): AgentCoordinator {
  const coordinator = new AgentCoordinator();

  // Register all 4 agents with placeholder handlers
  const defaultHandler = async (intent: any) => ({ success: true, data: { intent: intent.type, handled: true } });

  coordinator.registerAgent(bookkeeperProfile, defaultHandler);
  coordinator.registerAgent(taxStrategistProfile, defaultHandler);
  coordinator.registerAgent(collectionsProfile, defaultHandler);
  coordinator.registerAgent(insightsProfile, defaultHandler);

  return coordinator;
}
