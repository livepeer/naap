/**
 * Skill Interfaces
 *
 * Defines the contracts for agent skills. The orchestrator depends on
 * these abstractions, not on concrete implementations (Dependency Inversion).
 */

import type { AnalyticsResult, QueryPlan, RenderSpec } from '../types';

/**
 * AnalyticSkill: converts a natural-language question into a structured
 * query plan, then executes it against the Leaderboard API.
 */
export interface IAnalyticSkill {
  analyzeIntent(question: string): Promise<QueryPlan>;
  executeQuery(plan: QueryPlan): Promise<AnalyticsResult>;
}

/**
 * UXSkill: given a user question and analytics data, produces a RenderSpec
 * that describes which visualizations to display and how to lay them out.
 */
export interface IUXSkill {
  generateRenderSpec(question: string, data: AnalyticsResult): Promise<RenderSpec>;
}

/**
 * Callbacks the orchestrator uses to communicate progress to the UI.
 */
export interface AgentCallbacks {
  onStep: (step: string, detail?: string) => void;
  onComplete: (renderSpec: RenderSpec, data: AnalyticsResult, summary: string) => void;
  onError: (error: string) => void;
}
