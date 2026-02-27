/**
 * AnalyticSkill
 *
 * Responsible for:
 *   1. Analyzing user intent via Gemini to produce a structured QueryPlan
 *   2. Executing the plan against the Leaderboard API
 *
 * The Gemini system prompt contains the Leaderboard API schema so the LLM
 * can map free-text questions to precise query parameters.
 */

import type { IAnalyticSkill } from './types';
import type {
  QueryPlan,
  AnalyticsResult,
  GeminiRequest,
  GeminiResponse,
  OrchestratorStats,
  PipelineEntry,
} from '../types';

const SYSTEM_PROMPT = `You are an analytics query planner for the Livepeer AI network.

Your job is to convert a user's natural-language question into a SINGLE structured JSON query plan.

Available pipelines and their default models (orchestrator counts in parentheses):
- "text-to-image": "SG161222/RealVisXL_V4.0_Lightning" (3 orchestrators), "black-forest-labs/FLUX.1-dev" (1)
- "live-video-to-video": "streamdiffusion-sdxl" (18 orchestrators — most active pipeline), "noop" (1)
- "llm": "meta-llama/Meta-Llama-3.1-8B-Instruct" (1)
- "upscale": "stabilityai/stable-diffusion-x4-upscaler" (1)

Available metrics (per orchestrator):
- "score": overall performance score (composite of success rate + latency)
- "latency": round-trip response time / speed
- "success_rate": percentage of successful responses
- "all": return all metrics

The API does NOT have traffic volume or request count data. If the user asks about "traffic", "volume", or "busiest", use "live-video-to-video" with "streamdiffusion-sdxl" (the most active pipeline) and metric "score".

If the user asks about "fastest" or "speed", use metric "latency".
If the user asks about "best" or "top", use metric "score".
If the user asks about "reliable" or "uptime", use metric "success_rate".
If unclear, default to metric "all".

If the user does not specify a pipeline, default to "live-video-to-video" (most data).
IMPORTANT: The "model" field must ALWAYS be a specific model name from the list above. Never use "all" or any generic value. If the user does not specify a model, use the default model for that pipeline.

IMPORTANT: Always respond with exactly ONE JSON object, never an array. Pick the single best pipeline/model for the question.

Respond with ONLY a single JSON object (no markdown, no explanation, no array):
{
  "pipeline": "<pipeline-id>",
  "model": "<specific-model-name>",
  "metric": "<latency|success_rate|score|all>",
  "topN": <number, default 10>
}`;

type GeminiCaller = (request: GeminiRequest) => Promise<GeminiResponse>;
type StatsFetcher = (pipeline: string, model: string) => Promise<OrchestratorStats[]>;
type PipelinesFetcher = () => Promise<PipelineEntry[]>;

const DEFAULT_MODELS: Record<string, string> = {
  'live-video-to-video': 'streamdiffusion-sdxl',
  'text-to-image': 'SG161222/RealVisXL_V4.0_Lightning',
  'llm': 'meta-llama/Meta-Llama-3.1-8B-Instruct',
  'upscale': 'stabilityai/stable-diffusion-x4-upscaler',
};

const GENERIC_MODEL_VALUES = new Set(['all', 'any', 'default', '*', '']);

function resolveModel(pipeline: string, model: string | undefined): string {
  if (!model || GENERIC_MODEL_VALUES.has(model.toLowerCase())) {
    return DEFAULT_MODELS[pipeline] || DEFAULT_MODELS['text-to-image'];
  }
  return model;
}

export function createAnalyticSkill(
  callGemini: GeminiCaller,
  fetchStats: StatsFetcher,
  _fetchPipelines: PipelinesFetcher,
): IAnalyticSkill {
  return {
    async analyzeIntent(question: string): Promise<QueryPlan> {
      const request: GeminiRequest = {
        contents: [{ role: 'user', parts: [{ text: question }] }],
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 256,
          responseMimeType: 'application/json',
        },
      };

      const response = await callGemini(request);
      const text = response.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        return { pipeline: 'live-video-to-video', model: DEFAULT_MODELS['live-video-to-video'], metric: 'all', topN: 10 };
      }

      try {
        let parsed = JSON.parse(text);
        // If Gemini returns an array, take the first element
        if (Array.isArray(parsed)) {
          parsed = parsed[0] ?? {};
        }
        const plan = parsed as QueryPlan;
        const pipeline = plan.pipeline || 'live-video-to-video';
        return {
          pipeline,
          model: resolveModel(pipeline, plan.model),
          metric: plan.metric || 'all',
          topN: plan.topN ?? 10,
        };
      } catch {
        return { pipeline: 'live-video-to-video', model: DEFAULT_MODELS['live-video-to-video'], metric: 'all', topN: 10 };
      }
    },

    async executeQuery(plan: QueryPlan): Promise<AnalyticsResult> {
      const rawStats = await fetchStats(plan.pipeline, plan.model);

      const statsArray = Array.isArray(rawStats) ? rawStats : [];
      const sorted = statsArray.sort((a, b) => b.score - a.score);
      const topN = sorted.slice(0, plan.topN || 10);

      const totalOrchestrators = topN.length;
      const avgScore = totalOrchestrators > 0
        ? topN.reduce((s, o) => s + o.score, 0) / totalOrchestrators
        : 0;
      const avgLatency = totalOrchestrators > 0
        ? topN.reduce((s, o) => s + (o.avg_time || 0), 0) / totalOrchestrators
        : 0;
      const avgSuccessRate = totalOrchestrators > 0
        ? topN.reduce((s, o) => s + o.success_rate, 0) / totalOrchestrators
        : 0;

      return {
        pipeline: plan.pipeline,
        model: plan.model,
        orchestrators: topN,
        metadata: {
          totalOrchestrators,
          avgScore: Math.round(avgScore * 100) / 100,
          avgLatency: Math.round(avgLatency),
          avgSuccessRate: Math.round(avgSuccessRate * 100) / 100,
        },
      };
    },
  };
}
