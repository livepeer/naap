/**
 * Dashboard /agent-summary — the LLM moat.
 *
 * Calls Gemini for a 1–2 sentence judgment line summarizing the user's
 * most pressing financial situation. Caches 15 min per tenant in a
 * process-local Map; falls back to a deterministic counts string if the
 * LLM is slow (>3s) or fails.
 */

import type { Request, Response } from 'express';

// Lazy import to avoid circular dependency with server.ts (which imports
// handleDashboardAgentSummary from this file). server.ts is only loaded the
// first time the LLM is actually invoked.
async function defaultCallGemini(sys: string, user: string, max?: number): Promise<string | null> {
  const mod = await import('../server.js');
  return mod.callGemini(sys, user, max);
}

export interface SummaryFacts {
  overdueCount: number;
  overdueAmountCents: number;
  taxDaysOut: number | null;
}

export interface SummaryResult {
  summary: string;
  generatedAt: string;
  source: 'llm' | 'fallback';
}

const CACHE_TTL_MS = 15 * 60 * 1000;
const LLM_TIMEOUT_MS = 3000;

interface CacheEntry { value: SummaryResult; expiresAt: number; }
const cache = new Map<string, CacheEntry>();

export function _resetCache(): void { cache.clear(); }

function fmtUSD(cents: number): string {
  return '$' + Math.abs(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function buildDeterministicSummary(f: SummaryFacts): string {
  const parts: string[] = [];
  if (f.overdueCount > 0) {
    parts.push(`${f.overdueCount} invoice${f.overdueCount === 1 ? '' : 's'} overdue (${fmtUSD(f.overdueAmountCents)})`);
  }
  if (f.taxDaysOut !== null && f.taxDaysOut <= 14) {
    parts.push(`Tax payment in ${f.taxDaysOut} days`);
  }
  return parts.length === 0 ? 'All clear ☕' : parts.join('. ') + '.';
}

const SYSTEM_PROMPT = `You are a small-business accounting copilot. In ONE or TWO sentences, summarize the user's most pressing financial situation right now. Use plain language. Suggest the single highest-leverage action when appropriate. No emojis. No bullet points. Under 200 characters.`;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }).catch(() => { clearTimeout(timer); resolve(null); });
  });
}

export async function computeSummary(
  tenantId: string,
  facts: SummaryFacts,
  callLLM: (sys: string, user: string, max?: number) => Promise<string | null> = defaultCallGemini
): Promise<SummaryResult> {
  const cached = cache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const userMsg = `Facts: ${JSON.stringify(facts)}`;
  const llmRaw = await withTimeout(callLLM(SYSTEM_PROMPT, userMsg, 200), LLM_TIMEOUT_MS);
  const summary = (llmRaw && llmRaw.trim().length > 0) ? llmRaw.trim() : buildDeterministicSummary(facts);
  const source: 'llm' | 'fallback' = llmRaw ? 'llm' : 'fallback';

  const result: SummaryResult = { summary, generatedAt: new Date().toISOString(), source };
  cache.set(tenantId, { value: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

export async function handleDashboardAgentSummary(req: Request, res: Response): Promise<void> {
  const tenantId: string = (req as any).tenantId;
  const facts: SummaryFacts = {
    overdueCount: parseInt(String(req.query.overdueCount || '0'), 10),
    overdueAmountCents: parseInt(String(req.query.overdueAmountCents || '0'), 10),
    taxDaysOut: req.query.taxDaysOut !== undefined ? parseInt(String(req.query.taxDaysOut), 10) : null,
  };

  const result = await computeSummary(tenantId, facts);
  res.json({ success: true, data: result });
}
