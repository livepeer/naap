/**
 * AgentBook Agent Brain Orchestrator
 *
 * Central pipeline: session recovery → context assembly → classification →
 * complexity assessment → planning or direct execution → learning.
 *
 * Exports a single function: handleAgentMessage(req, ctx)
 */

import { db } from './db/client.js';
import { retrieveRelevantMemories, learnFromInteraction, handleCorrection } from './agent-memory.js';
import { assessComplexity, generatePlan, formatPlan, createSession, getActiveSession, updateSession, executeStep, buildUndoAction } from './agent-planner.js';
import { PlanStep, Evaluation, assessStepQuality, buildFinalEvaluation, formatEvaluation } from './agent-evaluator.js';

// ─── Types ──────────────────────────────────────────────────────────────────

interface AgentRequest {
  text: string;
  tenantId: string;
  channel: string;
  attachments?: { type: string; url: string }[];
  sessionAction?: string;
  feedback?: string;
}

interface AgentContext {
  skills: any[];
  callGemini: (sys: string, user: string, max?: number) => Promise<string | null>;
  baseUrls: Record<string, string>;
  classifyAndExecuteV1: (
    text: string,
    tenantId: string,
    channel: string,
    attachments?: any[],
    memory?: any[],
    skills?: any[],
    conversation?: any[],
    tenantConfig?: any,
  ) => Promise<any>;
}

interface AgentResponse {
  success: true;
  data: {
    message: string;
    actions?: any[];
    chartData?: any;
    skillUsed: string;
    confidence: number;
    latencyMs?: number;
    plan?: { steps: PlanStep[]; requiresConfirmation: boolean };
    evaluation?: Evaluation;
    sessionId?: string;
    suggestions?: string[];
    undoAvailable?: boolean;
  };
}

// ─── Text matchers for session actions ──────────────────────────────────────

const CANCEL_RE = /^(cancel|stop|abort|nevermind|n)$/i;
const STATUS_RE = /^(status|where was i)$/i;
const SKIP_RE = /^(skip|next)$/i;
const UNDO_RE = /^(undo|revert)$/i;
const CONFIRM_RE = /^(yes|confirm|go|ok|proceed|do it|y)$/i;

// ─── Helpers ────────────────────────────────────────────────────────────────

function resolveSessionAction(
  explicit: string | undefined,
  text: string,
): string | null {
  if (explicit) return explicit;
  const trimmed = text.trim();
  if (CANCEL_RE.test(trimmed)) return 'cancel';
  if (STATUS_RE.test(trimmed)) return 'status';
  if (SKIP_RE.test(trimmed)) return 'skip';
  if (UNDO_RE.test(trimmed)) return 'undo';
  if (CONFIRM_RE.test(trimmed)) return 'confirm';
  return null;
}

function resolveBaseUrlForEndpoint(
  endpoint: string,
  baseUrls: Record<string, string>,
): string {
  for (const [prefix, url] of Object.entries(baseUrls)) {
    if (endpoint.startsWith(prefix)) return url;
  }
  // Fallback: partial match
  for (const [prefix, url] of Object.entries(baseUrls)) {
    if (endpoint.includes(prefix.replace(/^\/api\/v1\//, ''))) return url;
  }
  return '';
}

function buildResponse(data: AgentResponse['data']): AgentResponse {
  return { success: true, data };
}

// ─── Main ───────────────────────────────────────────────────────────────────

export async function handleAgentMessage(
  req: AgentRequest,
  ctx: AgentContext,
): Promise<AgentResponse> {
  const startTime = Date.now();
  const { text, tenantId, channel, attachments, feedback } = req;
  const expenseBaseUrl = ctx.baseUrls['/api/v1/agentbook-expense'] || 'http://localhost:4051';

  // ── Step 0: Handle feedback / corrections ──────────────────────────────
  if (feedback) {
    try {
      const lastConvo = await db.abConversation.findFirst({
        where: { tenantId, queryType: 'agent' },
        orderBy: { createdAt: 'desc' },
      });
      const lastResult = (lastConvo?.data as any) ?? null;
      const correction = await handleCorrection(tenantId, feedback, lastResult, expenseBaseUrl);
      if (correction.applied) {
        return buildResponse({
          message: correction.message,
          skillUsed: 'correction',
          confidence: 1,
          latencyMs: Date.now() - startTime,
        });
      }
      // Not applied — fall through, treat feedback text as a regular message
    } catch {
      // Fall through to normal processing
    }
  }

  // ── Step 1: Session recovery ───────────────────────────────────────────
  const activeSession = await getActiveSession(tenantId);

  if (activeSession) {
    const action = resolveSessionAction(req.sessionAction, text);

    if (action === 'cancel') {
      await updateSession(activeSession.id, activeSession.version, { status: 'expired' });
      return buildResponse({
        message: 'Plan cancelled.',
        skillUsed: 'session',
        confidence: 1,
        latencyMs: Date.now() - startTime,
      });
    }

    if (action === 'status') {
      const plan = (activeSession.plan as PlanStep[]) || [];
      const current = activeSession.currentStep ?? 0;
      const total = plan.length;
      const pending = activeSession.pendingConfirmation ? ' (awaiting confirmation)' : '';
      return buildResponse({
        message: `Session active: step ${current + 1} of ${total}${pending}. Trigger: "${activeSession.trigger}"`,
        skillUsed: 'session',
        confidence: 1,
        sessionId: activeSession.id,
        latencyMs: Date.now() - startTime,
      });
    }

    if (action === 'skip') {
      const plan = (activeSession.plan as PlanStep[]) || [];
      const current = activeSession.currentStep ?? 0;
      if (current < plan.length) {
        plan[current].status = 'skipped';
        await updateSession(activeSession.id, activeSession.version, {
          plan,
          currentStep: current + 1,
          pendingConfirmation: null,
        });
        return buildResponse({
          message: `Skipped step ${current + 1}: ${plan[current].description}`,
          skillUsed: 'session',
          confidence: 1,
          sessionId: activeSession.id,
          latencyMs: Date.now() - startTime,
        });
      }
      return buildResponse({
        message: 'No more steps to skip.',
        skillUsed: 'session',
        confidence: 1,
        latencyMs: Date.now() - startTime,
      });
    }

    if (action === 'undo') {
      const undoStack = (activeSession.undoStack as any[]) || [];
      if (undoStack.length === 0) {
        return buildResponse({
          message: 'Nothing to undo.',
          skillUsed: 'session',
          confidence: 1,
          latencyMs: Date.now() - startTime,
        });
      }
      const lastUndo = undoStack.pop()!;
      const baseUrl = resolveBaseUrlForEndpoint(lastUndo.reverseEndpoint, ctx.baseUrls);
      try {
        await fetch(`${baseUrl}${lastUndo.reverseEndpoint}`, {
          method: lastUndo.reverseMethod || 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': tenantId },
          body: JSON.stringify(lastUndo.reverseParams || {}),
        });
      } catch {
        // Best-effort undo
      }
      await updateSession(activeSession.id, activeSession.version, { undoStack });
      return buildResponse({
        message: `Undone: ${lastUndo.description}`,
        skillUsed: 'session',
        confidence: 1,
        sessionId: activeSession.id,
        undoAvailable: undoStack.length > 0,
        latencyMs: Date.now() - startTime,
      });
    }

    if (action === 'confirm' && activeSession.pendingConfirmation) {
      // Execute remaining steps
      const plan = (activeSession.plan as PlanStep[]) || [];
      const startStep = activeSession.currentStep ?? 0;
      const stepResults = (activeSession.stepResults as any[]) || [];
      const undoStack = (activeSession.undoStack as any[]) || [];
      let baseVersion = activeSession.version;

      // Clear pending confirmation first
      const cleared = await updateSession(activeSession.id, baseVersion, { pendingConfirmation: null });
      if (!cleared) {
        return buildResponse({
          message: 'Session was modified by another process. Please try again.',
          skillUsed: 'session',
          confidence: 1,
          latencyMs: Date.now() - startTime,
        });
      }
      baseVersion++;

      for (let i = startStep; i < plan.length; i++) {
        const step = plan[i];
        step.status = 'running';
        await updateSession(activeSession.id, baseVersion + (i - startStep), {
          plan,
          currentStep: i,
        });

        const result = await executeStep(step, tenantId, ctx.skills, ctx.baseUrls);
        step.result = result;
        step.quality = assessStepQuality(step);
        step.status = result?.success ? 'done' : 'failed';

        const undo = step.canUndo ? buildUndoAction(step) : null;
        if (undo) undoStack.push(undo);

        stepResults.push({ stepId: step.id, result });
      }

      const finalVersion = baseVersion + (plan.length - startStep);
      const evaluation = buildFinalEvaluation(plan);
      await updateSession(activeSession.id, finalVersion, {
        plan,
        stepResults,
        undoStack,
        status: 'completed',
        evaluation,
        currentStep: plan.length,
      });

      const evalMessage = formatEvaluation(evaluation, plan);
      return buildResponse({
        message: evalMessage,
        skillUsed: 'session',
        confidence: 1,
        sessionId: activeSession.id,
        evaluation,
        suggestions: evaluation.suggestions,
        undoAvailable: evaluation.undoAvailable,
        latencyMs: Date.now() - startTime,
      });
    }

    // No session action matched — fall through to normal processing
  }

  // ── Step 2: Context assembly ───────────────────────────────────────────
  const [tenantConfig, conversation, memory, skills] = await Promise.all([
    db.abTenantConfig.findFirst({ where: { userId: tenantId } }),
    db.abConversation.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    retrieveRelevantMemories(tenantId, text),
    db.abSkillManifest.findMany({
      where: { enabled: true, OR: [{ tenantId: null }, { tenantId }] },
    }),
  ]);

  // ── Step 3: Classify via v1 ────────────────────────────────────────────
  const v1Result = await ctx.classifyAndExecuteV1(
    text,
    tenantId,
    channel,
    attachments,
    memory,
    skills,
    conversation,
    tenantConfig,
  );

  if (!v1Result) {
    return buildResponse({
      message: 'I\'m not sure what you mean. Try "Spent $45 on lunch" or "How much on travel?"',
      skillUsed: 'none',
      confidence: 0,
      latencyMs: Date.now() - startTime,
    });
  }

  // ── Step 4: Complexity assessment ──────────────────────────────────────
  const complexity = assessComplexity(text, v1Result.selectedSkill, v1Result.confidence);

  if (complexity === 'complex') {
    const recentConvo = conversation
      .slice(0, 5)
      .reverse()
      .map((c: any) => `User: ${c.question}\nAgent: ${c.answer}`)
      .join('\n');
    const memoryContext = memory
      .map((m: any) => `${m.key}: ${m.value}`)
      .join('\n');

    const planSteps = await generatePlan(
      text,
      skills as any,
      tenantConfig || {},
      recentConvo,
      memoryContext,
      ctx.callGemini,
    );

    if (planSteps.length > 0) {
      const session = await createSession(tenantId, text, planSteps);
      await updateSession(session.id, session.version, { pendingConfirmation: { awaitingApproval: true } });

      const planMessage = formatPlan(planSteps);

      // Log conversation
      db.abConversation.create({
        data: {
          tenantId,
          question: text,
          answer: planMessage,
          queryType: 'agent',
          channel,
          skillUsed: 'planner',
          data: { plan: planSteps as any, sessionId: session.id },
        },
      }).catch(() => {});

      return buildResponse({
        message: planMessage,
        skillUsed: 'planner',
        confidence: v1Result.confidence,
        plan: { steps: planSteps, requiresConfirmation: true },
        sessionId: session.id,
        latencyMs: Date.now() - startTime,
      });
    }
    // Empty plan — fall through to simple execution
  }

  // ── Step 5: Simple execution (v1 path) ─────────────────────────────────
  const responseData = v1Result.responseData || {
    message: v1Result.skillResponse?.message || 'Done.',
    actions: v1Result.skillResponse?.actions,
    chartData: v1Result.skillResponse?.chartData,
    skillUsed: v1Result.skillUsed,
    confidence: v1Result.confidence,
  };

  // ── Step 6: Learning (best-effort) ─────────────────────────────────────
  learnFromInteraction(
    tenantId,
    v1Result.skillUsed,
    v1Result.extractedParams,
    v1Result.skillResponse,
    feedback,
  ).catch(() => {});

  // Log conversation (best-effort)
  db.abConversation.create({
    data: {
      tenantId,
      question: text,
      answer: responseData.message || '',
      queryType: 'agent',
      channel,
      skillUsed: responseData.skillUsed || v1Result.skillUsed || 'unknown',
      data: v1Result.skillResponse || {},
      latencyMs: Date.now() - startTime,
    },
  }).catch(() => {});

  return buildResponse({
    message: responseData.message,
    actions: responseData.actions,
    chartData: responseData.chartData,
    skillUsed: responseData.skillUsed || v1Result.skillUsed,
    confidence: responseData.confidence ?? v1Result.confidence,
    latencyMs: Date.now() - startTime,
  });
}
