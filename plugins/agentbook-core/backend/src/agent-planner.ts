import { db } from './db/client.js';
import { PlanStep } from './agent-evaluator.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface UndoAction {
  stepId: string;
  description: string;
  reverseEndpoint: string;
  reverseMethod: string;
  reverseParams: any;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MULTI_INTENT_PATTERNS = [
  /and then/i,
  /then /i,
  /also /i,
  /after that/i,
  /first.+?then/i,
];

const CONDITIONAL_PATTERN = /if.+then/i;

const DESTRUCTIVE_WORDS = [
  /\bdelete\b/i,
  /\bremove\b/i,
  /\bedit\b/i,
  /\bupdate\b/i,
  /\bchange\b/i,
  /\bmodify\b/i,
  /\bsplit\b/i,
  /\brecord\b/i,
  /\bcreate\b/i,
  /\badd\b/i,
];

const DESTRUCTIVE_SKILLS = new Set([
  'edit-expense',
  'split-expense',
  'categorize-expenses',
  'record-expense',
  'create-invoice',
]);

// ─── assessComplexity ────────────────────────────────────────────────────────

export function assessComplexity(
  text: string,
  selectedSkill: { name: string; confirmBefore?: boolean } | null,
  confidence: number,
): 'simple' | 'complex' {
  // Multi-intent keywords
  if (MULTI_INTENT_PATTERNS.some((p) => p.test(text))) return 'complex';

  // Skill requires confirmation before execution
  if (selectedSkill?.confirmBefore) return 'complex';

  // Low confidence
  if (confidence < 0.6) return 'complex';

  // Destructive word + destructive skill
  if (
    selectedSkill &&
    DESTRUCTIVE_SKILLS.has(selectedSkill.name) &&
    DESTRUCTIVE_WORDS.some((p) => p.test(text))
  ) {
    return 'complex';
  }

  // Conditional phrasing
  if (CONDITIONAL_PATTERN.test(text)) return 'complex';

  return 'simple';
}

// ─── generatePlan ────────────────────────────────────────────────────────────

export async function generatePlan(
  text: string,
  skills: Array<{ name: string; description?: string; endpoint?: string; method?: string }>,
  tenantConfig: Record<string, any>,
  recentConvo: string,
  relevantMemories: string,
  callGemini: (sys: string, user: string, max?: number) => Promise<string | null>,
): Promise<PlanStep[]> {
  const skillList = skills
    .map(
      (s) =>
        `- ${s.name}: ${s.description ?? '(no description)'}${s.endpoint ? ` [${s.method ?? 'GET'} ${s.endpoint}]` : ''}`,
    )
    .join('\n');

  const system = `You are an AI accounting assistant planner for AgentBook.
Your task is to decompose a user request into an ordered list of discrete steps.

Available skills:
${skillList}

Tenant configuration:
${JSON.stringify(tenantConfig, null, 2)}

Recent conversation context:
${recentConvo || '(none)'}

Relevant memories:
${relevantMemories || '(none)'}

Rules:
1. Return ONLY valid JSON — an array of step objects, nothing else.
2. Each step must have: action (string), description (string), params (object), dependsOn (array of step IDs), canUndo (boolean).
3. The last step MUST always be: { "action": "evaluate-results", "description": "Evaluate results", "params": {}, "dependsOn": [...all previous step ids...], "canUndo": false }
4. Use only actions from the available skills list, plus "evaluate-results".
5. dependsOn should reference actual step IDs from the same plan.`;

  const user = `User request: "${text}"

Return a JSON array of steps to fulfil this request. Remember to end with an evaluate-results step.`;

  let raw: string | null = null;
  try {
    raw = await callGemini(system, user, 1024);
  } catch {
    return [];
  }

  if (!raw) return [];

  // Extract JSON array from the response (LLM may wrap in markdown)
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  let parsed: any[];
  try {
    parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];
  } catch {
    return [];
  }

  // Assign sequential IDs, ignoring whatever the LLM provided
  const idMap = new Map<string, string>();
  const steps: PlanStep[] = parsed.map((raw: any, i: number) => {
    const newId = `step-${i + 1}`;
    const oldId: string = raw.id ?? String(i + 1);
    idMap.set(oldId, newId);
    return {
      id: newId,
      action: String(raw.action ?? ''),
      description: String(raw.description ?? ''),
      params: raw.params && typeof raw.params === 'object' ? raw.params : {},
      dependsOn: [],
      canUndo: Boolean(raw.canUndo),
      status: 'pending' as const,
    };
  });

  // Fix dependsOn references to use the newly assigned IDs
  parsed.forEach((raw: any, i: number) => {
    const deps: string[] = Array.isArray(raw.dependsOn) ? raw.dependsOn : [];
    steps[i].dependsOn = deps
      .map((d: string) => idMap.get(d) ?? d)
      .filter((d: string) => steps.some((s) => s.id === d));
  });

  return steps;
}

// ─── formatPlan ──────────────────────────────────────────────────────────────

export function formatPlan(steps: PlanStep[]): string {
  const lines: string[] = ["Here's my plan:\n"];
  steps.forEach((step, i) => {
    const irreversible = !step.canUndo && step.action !== 'evaluate-results' ? ' (irreversible)' : '';
    lines.push(`${i + 1}. ${step.description}${irreversible}`);
  });
  lines.push('\nProceed? (yes/no)');
  return lines.join('\n');
}

// ─── createSession ───────────────────────────────────────────────────────────

export async function createSession(
  tenantId: string,
  trigger: string,
  plan: PlanStep[],
): Promise<any> {
  // Expire any existing active sessions for this tenant
  await db.abAgentSession.updateMany({
    where: { tenantId, status: 'active' },
    data: { status: 'expired' },
  });

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  return db.abAgentSession.create({
    data: {
      tenantId,
      trigger,
      plan: plan as any,
      status: 'active',
      currentStep: 0,
      stepResults: [],
      undoStack: [],
      expiresAt,
    },
  });
}

// ─── getActiveSession ─────────────────────────────────────────────────────────

export async function getActiveSession(tenantId: string): Promise<any | null> {
  return db.abAgentSession.findFirst({
    where: {
      tenantId,
      status: 'active',
      expiresAt: { gt: new Date() },
    },
  });
}

// ─── updateSession ────────────────────────────────────────────────────────────

export async function updateSession(
  id: string,
  version: number,
  data: {
    plan?: PlanStep[];
    stepResults?: any[];
    currentStep?: number;
    undoStack?: any[];
    pendingConfirmation?: any;
    status?: string;
    evaluation?: any;
  },
): Promise<boolean> {
  const {
    plan,
    stepResults,
    currentStep,
    undoStack,
    pendingConfirmation,
    status,
    evaluation,
  } = data;

  const result = await db.$executeRaw`
    UPDATE "plugin_agentbook_core"."AbAgentSession"
    SET "version" = "version" + 1, "updatedAt" = NOW(),
        "plan" = COALESCE(${plan ? JSON.stringify(plan) : null}::jsonb, "plan"),
        "stepResults" = COALESCE(${stepResults ? JSON.stringify(stepResults) : null}::jsonb, "stepResults"),
        "currentStep" = COALESCE(${currentStep ?? null}, "currentStep"),
        "undoStack" = COALESCE(${undoStack ? JSON.stringify(undoStack) : null}::jsonb, "undoStack"),
        "pendingConfirmation" = ${pendingConfirmation !== undefined ? (pendingConfirmation ? JSON.stringify(pendingConfirmation) : null) : null}::jsonb,
        "status" = COALESCE(${status ?? null}, "status"),
        "evaluation" = COALESCE(${evaluation ? JSON.stringify(evaluation) : null}::jsonb, "evaluation")
    WHERE "id" = ${id} AND "version" = ${version}`;

  return result > 0;
}

// ─── executeStep ─────────────────────────────────────────────────────────────

export async function executeStep(
  step: PlanStep,
  tenantId: string,
  skills: Array<{
    name: string;
    endpoint?: string;
    method?: string;
  }>,
  baseUrls: Record<string, string>,
): Promise<any> {
  // Internal evaluate-results step — handled by caller
  if (step.action === 'evaluate-results') {
    return { success: true, data: { evaluated: true } };
  }

  const skill = skills.find((s) => s.name === step.action);

  if (!skill) {
    return { success: false, error: `Unknown skill: ${step.action}` };
  }

  const endpoint = skill.endpoint as any;
  if (!endpoint || !endpoint.url) {
    return { success: false, error: `Skill "${step.action}" has no endpoint` };
  }

  if (endpoint.method === 'INTERNAL') {
    return { success: false, error: `Skill "${step.action}" is internal and cannot be executed via HTTP` };
  }

  // Resolve base URL: find the base URL key whose prefix matches the skill endpoint URL
  let baseUrl = '';
  for (const [prefix, url] of Object.entries(baseUrls)) {
    if (endpoint.url.startsWith(prefix)) {
      baseUrl = url;
      break;
    }
  }

  if (!baseUrl) {
    // Fallback: try to find by partial prefix match
    const entries = Object.entries(baseUrls);
    for (const [prefix, url] of entries) {
      if (endpoint.url.includes(prefix.replace(/^\/api\/v1\//, ''))) {
        baseUrl = url;
        break;
      }
    }
  }

  const method = (endpoint.method ?? 'GET').toUpperCase();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    let url: string;
    let fetchOptions: RequestInit;

    // Build URL: substitute path params from step.params, remainder goes to query/body
    let endpointPath = endpoint.url;
    const unusedParams: Record<string, any> = { ...step.params };

    // Replace path parameters like {id} or :id
    endpointPath = endpointPath.replace(/\{(\w+)\}|:(\w+)/g, (_match: string, p1: string, p2: string) => {
      const key = p1 ?? p2;
      if (key in unusedParams) {
        const val = unusedParams[key];
        delete unusedParams[key];
        return encodeURIComponent(String(val));
      }
      return _match;
    });

    if (method === 'GET') {
      const qs = new URLSearchParams(
        Object.entries(unusedParams)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => [k, String(v)]),
      ).toString();
      url = `${baseUrl}${endpointPath}${qs ? `?${qs}` : ''}`;
      fetchOptions = {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId,
        },
        signal: controller.signal,
      };
    } else {
      url = `${baseUrl}${endpointPath}`;
      fetchOptions = {
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': tenantId,
        },
        body: JSON.stringify(unusedParams),
        signal: controller.signal,
      };
    }

    const response = await fetch(url, fetchOptions);
    const json = await response.json();
    return json;
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return { success: false, error: 'Step execution timed out after 30s' };
    }
    return { success: false, error: String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── buildUndoAction ─────────────────────────────────────────────────────────

export function buildUndoAction(step: PlanStep): UndoAction | null {
  switch (step.action) {
    case 'record-expense': {
      const id = step.result?.id ?? step.params?.id;
      if (!id) return null;
      return {
        stepId: step.id,
        description: `Undo: reject expense ${id}`,
        reverseEndpoint: `/api/v1/agentbook-expense/expenses/${id}/reject`,
        reverseMethod: 'POST',
        reverseParams: {},
      };
    }

    case 'categorize-expenses':
      // Not cleanly reversible
      return null;

    default:
      return null;
  }
}
