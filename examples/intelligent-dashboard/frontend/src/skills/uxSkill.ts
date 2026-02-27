/**
 * UXSkill
 *
 * Responsible for choosing the best visualization components and layout
 * for a given analytics result. Uses Gemini to interpret the data shape
 * and user intent, then returns a structured RenderSpec.
 *
 * Fallback: if Gemini returns invalid JSON, defaults to a data_table layout.
 */

import type { IUXSkill } from './types';
import type {
  AnalyticsResult,
  RenderSpec,
  GeminiRequest,
  GeminiResponse,
} from '../types';

const SYSTEM_PROMPT = `You are a data visualization expert. Given a user question and analytics data summary, choose the best dashboard layout.

Available panel types:
- "bar_chart": horizontal bar chart comparing values across items. Use for ranking, comparisons.
  config: { "valueKey": "<field>", "labelKey": "<field>", "color": "purple|blue|green|amber" }
- "data_table": sortable table with columns. Use when users need detailed multi-column data.
  config: { "columns": ["<field1>", "<field2>", ...] }
- "metric_gauge": single large number with label. Use for KPI highlights (averages, totals).
  config: { "value": <number>, "label": "<text>", "unit": "<ms|%|pts>", "color": "green|amber|red" }

Available layouts:
- "single": one full-width panel
- "grid": 2-3 panels in a grid (best for mixed viz types)
- "split": two panels side-by-side

Rules:
- Always include at least one bar_chart or data_table for the main data.
- Add 1-3 metric_gauge panels for key summary statistics.
- Prefer "grid" layout for rich answers, "single" for simple answers.
- The "dataKey" for bar_chart and data_table should be "orchestrators" (the main data array).
- For metric_gauge, use inline values from the data summary provided.

Respond with ONLY a JSON object (no markdown):
{
  "layout": "single|grid|split",
  "title": "<dashboard title>",
  "summary": "<1-2 sentence natural language answer>",
  "panels": [ { "type": "...", "title": "...", "dataKey": "...", "config": {...} }, ... ]
}`;

type GeminiCaller = (request: GeminiRequest) => Promise<GeminiResponse>;

function summarizeData(data: AnalyticsResult): string {
  const { pipeline, model, orchestrators, metadata } = data;
  const top3 = orchestrators.slice(0, 3).map(o =>
    `${o.orchestrator.slice(0, 10)}... (score: ${o.score}, latency: ${o.avg_time || 'N/A'}ms, success: ${(o.success_rate * 100).toFixed(0)}%)`,
  );

  return [
    `Pipeline: ${pipeline}, Model: ${model}`,
    `Total orchestrators: ${metadata.totalOrchestrators}`,
    `Average score: ${metadata.avgScore}, Avg latency: ${metadata.avgLatency}ms, Avg success rate: ${(metadata.avgSuccessRate * 100).toFixed(1)}%`,
    `Top 3: ${top3.join('; ')}`,
    `Fields per orchestrator: orchestrator (address), score, latency_score, success_rate, total_rounds, avg_time, errors_count`,
  ].join('\n');
}

function buildFallbackSpec(data: AnalyticsResult): RenderSpec {
  return {
    layout: 'grid',
    title: `${data.pipeline} — ${data.model}`,
    summary: `Showing top ${data.metadata.totalOrchestrators} orchestrators.`,
    panels: [
      {
        type: 'metric_gauge',
        title: 'Avg Score',
        dataKey: 'metadata',
        config: { value: data.metadata.avgScore, label: 'Average Score', unit: 'pts', color: 'purple' },
      },
      {
        type: 'metric_gauge',
        title: 'Avg Latency',
        dataKey: 'metadata',
        config: { value: data.metadata.avgLatency, label: 'Avg Latency', unit: 'ms', color: 'amber' },
      },
      {
        type: 'bar_chart',
        title: 'Orchestrator Scores',
        dataKey: 'orchestrators',
        config: { valueKey: 'score', labelKey: 'orchestrator', color: 'purple' },
      },
      {
        type: 'data_table',
        title: 'Detailed Stats',
        dataKey: 'orchestrators',
        config: { columns: ['orchestrator', 'score', 'success_rate', 'avg_time', 'total_rounds'] },
      },
    ],
  };
}

export function createUXSkill(callGemini: GeminiCaller): IUXSkill {
  return {
    async generateRenderSpec(question: string, data: AnalyticsResult): Promise<RenderSpec> {
      const dataSummary = summarizeData(data);

      const request: GeminiRequest = {
        contents: [
          {
            role: 'user',
            parts: [{ text: `User question: "${question}"\n\nData summary:\n${dataSummary}` }],
          },
        ],
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
          responseMimeType: 'application/json',
        },
      };

      try {
        const response = await callGemini(request);
        const text = response.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) return buildFallbackSpec(data);

        const spec = JSON.parse(text) as RenderSpec;

        if (!spec.panels || !Array.isArray(spec.panels) || spec.panels.length === 0) {
          return buildFallbackSpec(data);
        }

        return {
          layout: spec.layout || 'grid',
          title: spec.title || `${data.pipeline} Analytics`,
          summary: spec.summary || '',
          panels: spec.panels,
        };
      } catch {
        return buildFallbackSpec(data);
      }
    },
  };
}
