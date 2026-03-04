// ── Leaderboard API types ──

/**
 * The actual upstream pipelines response:
 * { pipelines: [{ id: "text-to-image", models: ["FLUX.1-dev", ...], regions: ["SEA"] }] }
 */
export interface PipelineEntry {
  id: string;
  models: string[];
  regions?: string[];
}

export interface PipelinesApiResponse {
  pipelines: PipelineEntry[];
}

/**
 * The upstream aggregated stats response is a dict keyed by orchestrator address:
 * { "0xabc": { "SEA": { success_rate: 1, round_trip_score: 0.8, score: 0.93 } } }
 */
export type AggregatedStatsApiResponse = Record<
  string,
  Record<string, { success_rate: number; round_trip_score: number; score: number }>
>;

export interface OrchestratorStats {
  orchestrator: string;
  score: number;
  latency_score: number;
  success_rate: number;
  total_rounds: number;
  avg_time?: number;
  errors_count?: number;
  region?: string;
}

export interface RawStatsEntry {
  timestamp: string;
  response_time: number;
  success: boolean;
  region?: string;
}

export type RawStatsResponse = RawStatsEntry[];

// ── Gemini API types ──

export interface GeminiMessage {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: unknown };
}

export interface GeminiRequest {
  contents: GeminiMessage[];
  generationConfig?: {
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
    responseMimeType?: string;
  };
  systemInstruction?: { parts: Array<{ text: string }> };
}

export interface GeminiResponse {
  candidates: Array<{
    content: { parts: GeminiPart[] };
    finishReason?: string;
  }>;
}

// ── Agent types ──

export type AgentStep = 'idle' | 'analyzing' | 'fetching' | 'designing' | 'rendering' | 'complete' | 'error';

export interface ConversationEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  renderSpec?: RenderSpec | null;
  analyticsData?: AnalyticsResult | null;
  step?: AgentStep;
  error?: string;
}

// ── Skill types (re-exported from skills/types.ts for convenience) ──

export interface QueryPlan {
  pipeline: string;
  model: string;
  metric: 'latency' | 'success_rate' | 'score' | 'all';
  topN?: number;
}

export interface AnalyticsResult {
  pipeline: string;
  model: string;
  orchestrators: OrchestratorStats[];
  metadata: {
    totalOrchestrators: number;
    avgScore: number;
    avgLatency: number;
    avgSuccessRate: number;
  };
}

export type PanelType = 'bar_chart' | 'data_table' | 'metric_gauge';

export interface PanelSpec {
  type: PanelType;
  title: string;
  dataKey: string;
  config?: Record<string, unknown>;
}

export interface RenderSpec {
  layout: 'single' | 'grid' | 'split';
  panels: PanelSpec[];
  title: string;
  summary: string;
}
