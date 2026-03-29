/**
 * Agent Coordinator — Routes intents to specialized sub-agents.
 * The orchestrator delegates, sub-agents execute.
 */

import type { AgentId, AgentProfile, AgentMessage, AgentConfig } from './types.js';
import type { Intent, TenantConfig } from '../types.js';

export type SubAgentHandler = (intent: Intent, config: TenantConfig) => Promise<{ success: boolean; data?: any; error?: string }>;

export class AgentCoordinator {
  private agents: Map<AgentId, AgentProfile> = new Map();
  private handlers: Map<AgentId, SubAgentHandler> = new Map();
  private intentRouting: Map<string, AgentId> = new Map();
  private messageLog: AgentMessage[] = [];

  registerAgent(profile: AgentProfile, handler: SubAgentHandler): void {
    this.agents.set(profile.id, profile);
    this.handlers.set(profile.id, handler);

    for (const intent of profile.ownedIntents) {
      this.intentRouting.set(intent, profile.id);
    }
  }

  routeIntent(intent: Intent): AgentId | null {
    return this.intentRouting.get(intent.type) || null;
  }

  async dispatch(intent: Intent, config: TenantConfig): Promise<{ agentId: AgentId; success: boolean; data?: any; error?: string }> {
    const agentId = this.routeIntent(intent);
    if (!agentId) {
      return { agentId: 'bookkeeper', success: false, error: `No agent registered for intent: ${intent.type}` };
    }

    const handler = this.handlers.get(agentId);
    if (!handler) {
      return { agentId, success: false, error: `Agent "${agentId}" has no handler` };
    }

    const profile = this.agents.get(agentId)!;
    const start = Date.now();

    try {
      const result = await handler(intent, config);

      // Update metrics
      profile.metrics.totalActions++;
      profile.metrics.avgLatencyMs = (profile.metrics.avgLatencyMs * (profile.metrics.totalActions - 1) + (Date.now() - start)) / profile.metrics.totalActions;
      profile.metrics.lastActiveAt = new Date().toISOString();
      if (result.success) {
        profile.metrics.successRate = ((profile.metrics.successRate * (profile.metrics.totalActions - 1)) + 1) / profile.metrics.totalActions;
      }

      return { agentId, ...result };
    } catch (err) {
      return { agentId, success: false, error: String(err) };
    }
  }

  sendMessage(message: AgentMessage): void {
    this.messageLog.push(message);
    // TODO: Route to target agent's message handler
  }

  getAgent(id: AgentId): AgentProfile | undefined {
    return this.agents.get(id);
  }

  listAgents(): AgentProfile[] {
    return Array.from(this.agents.values());
  }

  getAgentConfig(id: AgentId): AgentConfig | undefined {
    return this.agents.get(id)?.config;
  }

  updateAgentConfig(id: AgentId, config: Partial<AgentConfig>): void {
    const agent = this.agents.get(id);
    if (agent) {
      agent.config = { ...agent.config, ...config };
    }
  }
}
