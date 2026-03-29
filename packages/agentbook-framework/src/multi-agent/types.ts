/**
 * Multi-Agent System Types.
 * Each sub-agent is a domain expert that owns specific skills.
 */

export type AgentId = 'bookkeeper' | 'tax-strategist' | 'collections' | 'insights';

export interface AgentProfile {
  id: AgentId;
  name: string;
  description: string;
  ownedSkills: string[];       // skill names this agent manages
  ownedIntents: string[];      // intent types routed to this agent
  metrics: AgentMetrics;
  config: AgentConfig;
}

export interface AgentMetrics {
  totalActions: number;
  successRate: number;         // 0-1
  avgLatencyMs: number;
  lastActiveAt: string;
  customMetrics: Record<string, number>; // agent-specific (e.g., categorization accuracy)
}

export interface AgentConfig {
  aggressiveness: number;      // 0-1 (gentle=0, firm=1)
  autoApprove: boolean;        // auto-execute or ask first
  notificationFrequency: 'realtime' | 'daily' | 'weekly';
  modelTier: 'fast' | 'standard' | 'premium';
}

export interface AgentMessage {
  from: AgentId;
  to: AgentId | 'orchestrator';
  type: 'request' | 'response' | 'event' | 'handoff';
  payload: Record<string, unknown>;
  timestamp: string;
}
