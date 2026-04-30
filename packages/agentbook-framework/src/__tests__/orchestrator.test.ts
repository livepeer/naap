import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Orchestrator, type OrchestratorConfig } from '../orchestrator.js';
import { SkillRegistry, type Skill, type Tool, type ToolDefinition, type TenantContext } from '../skill-registry.js';
import { ConstraintEngine } from '../constraint-engine.js';
import { Verifier } from '../verifier.js';
import { ContextAssembler } from '../context-assembler.js';
import { EscalationRouter } from '../escalation-router.js';
import { EventEmitter } from '../event-emitter.js';
import type { Intent, TenantConfig, ToolResult } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseTenantConfig: TenantConfig = {
  tenant_id: 'tenant-1',
  business_type: 'sole_proprietor',
  jurisdiction: 'us',
  region: 'CA',
  currency: 'USD',
  locale: 'en-US',
  timezone: 'America/Los_Angeles',
  fiscal_year_start: 1,
  auto_approve_limit_cents: 500_00,
};

function makeToolDef(name: string, constraints: string[] = []): ToolDefinition {
  return {
    name,
    description: `Tool ${name}`,
    input_schema: {},
    output_schema: {},
    constraints,
    model_tier: 'haiku',
  };
}

function makeTool(
  name: string,
  skillName: string,
  constraints: string[] = [],
  executeFn?: (input: Record<string, unknown>, ctx: TenantContext) => Promise<ToolResult>,
): Tool {
  return {
    name,
    skill_name: skillName,
    definition: makeToolDef(name, constraints),
    execute: executeFn ?? (async () => ({
      success: true,
      data: { amount_cents: 1000 },
      idempotency_key: `key-${name}`,
    })),
  };
}

function makeSkill(
  name: string,
  intents: string[],
  tools: Map<string, Tool>,
): Skill {
  return {
    manifest: {
      name,
      version: '1.0.0',
      description: `Skill ${name}`,
      intents,
      tools: Array.from(tools.values()).map(t => t.definition),
      prompts: {},
      dependencies: [],
    },
    tools,
    constraints: [],
  };
}

function createOrchestratorConfig(overrides?: Partial<OrchestratorConfig>): OrchestratorConfig {
  return {
    skillRegistry: new SkillRegistry(),
    constraintEngine: new ConstraintEngine(),
    verifier: new Verifier(),
    contextAssembler: new ContextAssembler(),
    escalationRouter: new EscalationRouter(),
    eventEmitter: new EventEmitter(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Orchestrator', () => {
  describe('processIntent() with valid intent', () => {
    it('runs tools and returns success', async () => {
      const registry = new SkillRegistry();
      const tool = makeTool('record_tool', 'expense-skill', [], async () => ({
        success: true,
        data: {
          lines: [
            { debit_cents: 1000, credit_cents: 0 },
            { debit_cents: 0, credit_cents: 1000 },
          ],
          amount_cents: 1000,
        },
        idempotency_key: 'key-1',
      }));
      const toolMap = new Map([['record_tool', tool]]);
      const skill = makeSkill('expense-skill', ['record_expense'], toolMap);
      registry.register(skill);

      const config = createOrchestratorConfig({ skillRegistry: registry });
      const orchestrator = new Orchestrator(config);

      const intent: Intent = { type: 'record_expense', amount_cents: 1000, vendor: 'Staples' };
      const result = await orchestrator.processIntent(intent, baseTenantConfig);

      expect(result.success).toBe(true);
      expect(result.intent).toBe(intent);
      expect(result.tool_results).toHaveLength(1);
      expect(result.tool_results[0].success).toBe(true);
      expect(result.verification_passed).toBe(true);
    });
  });

  describe('processIntent() with no matching skill', () => {
    it('returns error when no skill handles the intent', async () => {
      const config = createOrchestratorConfig();
      const orchestrator = new Orchestrator(config);

      const intent: Intent = { type: 'record_expense', amount_cents: 500 };
      const result = await orchestrator.processIntent(intent, baseTenantConfig);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No skill registered for intent type');
      expect(result.tool_results).toHaveLength(0);
    });
  });

  describe('processIntent() with constraint failure', () => {
    it('returns error with constraint name on pre_execution hard_gate failure', async () => {
      const registry = new SkillRegistry();
      const tool = makeTool('gated_tool', 'gated-skill', ['period_gate']);
      const toolMap = new Map([['gated_tool', tool]]);
      const skill = makeSkill('gated-skill', ['record_expense'], toolMap);
      registry.register(skill);

      const config = createOrchestratorConfig({ skillRegistry: registry });
      const orchestrator = new Orchestrator(config);

      // Intent with closed period - period_gate checks input.period_status
      const intent: Intent = { type: 'record_expense', amount_cents: 100 };
      // The constraint evaluates against the intent cast as Record<string,unknown>,
      // so we need period_status on the intent object. We'll use a type assertion.
      const intentWithPeriod = {
        ...intent,
        period_status: 'closed',
        period_id: '2024-12',
      } as unknown as Intent;

      const result = await orchestrator.processIntent(intentWithPeriod, baseTenantConfig);

      expect(result.success).toBe(false);
      expect(result.error).toContain('period_gate');
      expect(result.error).toContain('blocked execution');
    });

    it('returns error with constraint name on pre_commit hard_gate failure', async () => {
      const registry = new SkillRegistry();
      // Tool returns unbalanced lines -> balance_invariant (pre_commit) will fail
      const tool = makeTool('bad_tool', 'bad-skill', ['balance_invariant'], async () => ({
        success: true,
        data: {
          lines: [
            { debit_cents: 1000, credit_cents: 0 },
            { debit_cents: 0, credit_cents: 500 },
          ],
        },
        idempotency_key: 'key-bad',
      }));
      const toolMap = new Map([['bad_tool', tool]]);
      const skill = makeSkill('bad-skill', ['record_expense'], toolMap);
      registry.register(skill);

      const config = createOrchestratorConfig({ skillRegistry: registry });
      const orchestrator = new Orchestrator(config);

      const intent: Intent = { type: 'record_expense', amount_cents: 1000 };
      const result = await orchestrator.processIntent(intent, baseTenantConfig);

      expect(result.success).toBe(false);
      expect(result.error).toContain('balance_invariant');
      expect(result.error).toContain('Pre-commit constraint');
    });
  });

  describe('processIntent() with escalation', () => {
    it('returns escalation_id when amount exceeds threshold', async () => {
      const registry = new SkillRegistry();
      const tool = makeTool('expensive_tool', 'expensive-skill', ['amount_threshold']);
      const toolMap = new Map([['expensive_tool', tool]]);
      const skill = makeSkill('expensive-skill', ['record_expense'], toolMap);
      registry.register(skill);

      const config = createOrchestratorConfig({ skillRegistry: registry });
      const orchestrator = new Orchestrator(config);

      // amount_cents on the intent exceeds auto_approve_limit_cents (500_00)
      const intent = {
        type: 'record_expense',
        amount_cents: 1000_00, // $1000 > $500 limit
      } as Intent;

      const result = await orchestrator.processIntent(intent, baseTenantConfig);

      expect(result.success).toBe(false);
      expect(result.escalation_id).toBeDefined();
      expect(result.escalation_id).toMatch(/^esc-/);
      expect(result.error).toContain('Escalation required');
    });
  });

  describe('processIntent() with tool execution failure', () => {
    it('returns error when tool fails', async () => {
      const registry = new SkillRegistry();
      const tool = makeTool('failing_tool', 'fail-skill', [], async () => ({
        success: false,
        error: 'Database connection failed',
        idempotency_key: 'key-fail',
      }));
      const toolMap = new Map([['failing_tool', tool]]);
      const skill = makeSkill('fail-skill', ['record_expense'], toolMap);
      registry.register(skill);

      const config = createOrchestratorConfig({ skillRegistry: registry });
      const orchestrator = new Orchestrator(config);

      const intent: Intent = { type: 'record_expense', amount_cents: 100 };
      const result = await orchestrator.processIntent(intent, baseTenantConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database connection failed');
    });
  });

  describe('processIntent() with verification failure', () => {
    it('returns verification_passed false when verifier rejects', async () => {
      const registry = new SkillRegistry();
      // Tool returns data that will fail verification (unbalanced lines)
      const tool = makeTool('verify_fail_tool', 'vf-skill', [], async () => ({
        success: true,
        data: {
          lines: [
            { debit_cents: 1000, credit_cents: 0 },
            { debit_cents: 0, credit_cents: 999 },
          ],
        },
        idempotency_key: 'key-vf',
      }));
      const toolMap = new Map([['verify_fail_tool', tool]]);
      const skill = makeSkill('vf-skill', ['record_expense'], toolMap);
      registry.register(skill);

      const config = createOrchestratorConfig({ skillRegistry: registry });
      const orchestrator = new Orchestrator(config);

      const intent: Intent = { type: 'record_expense', amount_cents: 1000 };
      const result = await orchestrator.processIntent(intent, baseTenantConfig);

      expect(result.success).toBe(false);
      expect(result.verification_passed).toBe(false);
      expect(result.error).toContain('Verification failed');
    });
  });

  describe('processIntent() handles unexpected errors', () => {
    it('catches thrown errors and returns them in the result', async () => {
      const registry = new SkillRegistry();
      const tool = makeTool('throw_tool', 'throw-skill', [], async () => {
        throw new Error('unexpected kaboom');
      });
      const toolMap = new Map([['throw_tool', tool]]);
      const skill = makeSkill('throw-skill', ['record_expense'], toolMap);
      registry.register(skill);

      const config = createOrchestratorConfig({ skillRegistry: registry });
      const orchestrator = new Orchestrator(config);

      const intent: Intent = { type: 'record_expense', amount_cents: 100 };
      const result = await orchestrator.processIntent(intent, baseTenantConfig);

      expect(result.success).toBe(false);
      expect(result.error).toContain('unexpected kaboom');
    });
  });
});
