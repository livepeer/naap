/**
 * Orchestrator — The central nervous system.
 *
 * Receives intents from the interface layer (Telegram/Web) and produces
 * validated, audited financial actions.
 *
 * Pipeline: Intent Parse -> Context Assembly -> DAG Plan -> Execute -> Verify -> Commit
 */

import { SkillRegistry, type TenantContext } from './skill-registry.js';
import { ConstraintEngine } from './constraint-engine.js';
import { Verifier } from './verifier.js';
import { ContextAssembler } from './context-assembler.js';
import { EscalationRouter } from './escalation-router.js';
import { EventEmitter, emitEvent } from './event-emitter.js';
import type { Intent, DAGPlan, DAGNode, ToolResult, TenantConfig, LLMRequest, LLMResponse } from './types.js';

export interface OrchestratorConfig {
  skillRegistry: SkillRegistry;
  constraintEngine: ConstraintEngine;
  verifier: Verifier;
  contextAssembler: ContextAssembler;
  escalationRouter: EscalationRouter;
  eventEmitter: EventEmitter;
  llmCaller?: (request: LLMRequest) => Promise<LLMResponse>;
}

export interface ExecutionResult {
  success: boolean;
  intent: Intent;
  tool_results: ToolResult[];
  verification_passed?: boolean;
  escalation_id?: string;
  error?: string;
}

export class Orchestrator {
  private config: OrchestratorConfig;

  constructor(config: OrchestratorConfig) {
    this.config = config;
  }

  /**
   * Process a user message end-to-end.
   * This is the main entry point for the reactive path.
   */
  async processIntent(intent: Intent, tenantConfig: TenantConfig): Promise<ExecutionResult> {
    const { skillRegistry, constraintEngine, verifier, contextAssembler, escalationRouter } = this.config;

    try {
      // 1. Emit intent received event
      await emitEvent({
        tenant_id: tenantConfig.tenant_id,
        event_type: 'intent_received',
        actor: 'human',
        action: { intent },
      });

      // 2. Assemble context
      const context = await contextAssembler.assemble(intent, tenantConfig);

      // 3. Find skills that handle this intent
      const skills = skillRegistry.getSkillsForIntent(intent.type);
      if (skills.length === 0) {
        return {
          success: false,
          intent,
          tool_results: [],
          error: `No skill registered for intent type: ${intent.type}`,
        };
      }

      // 4. Build execution plan (simple linear for MVP, DAG in later phases)
      const skill = skills[0]; // Use first matching skill
      const toolResults: ToolResult[] = [];
      const tenantContext: TenantContext = { ...tenantConfig, ...context.data };

      // 5. Execute tools sequentially
      for (const [toolName, tool] of skill.tools) {
        // 5a. Pre-execution constraint check
        const preResults = constraintEngine.evaluate(
          tool.definition.constraints,
          'pre_execution',
          intent as unknown as Record<string, unknown>,
          tenantConfig,
        );

        if (constraintEngine.hasBlocker(preResults)) {
          const blocker = preResults.find(r => r.verdict === 'fail')!;
          return {
            success: false,
            intent,
            tool_results: toolResults,
            error: `Constraint "${blocker.constraint_name}" blocked execution: ${blocker.reason}`,
          };
        }

        if (constraintEngine.hasEscalation(preResults)) {
          const escalation = preResults.find(r => r.verdict === 'escalate')!;
          // TODO: Create escalation record and pause execution
          return {
            success: false,
            intent,
            tool_results: toolResults,
            escalation_id: `esc-${Date.now()}`,
            error: `Escalation required: ${escalation.reason}`,
          };
        }

        // 5b. Execute tool
        const result = await tool.execute(intent as unknown as Record<string, unknown>, tenantContext);
        toolResults.push(result);

        if (!result.success) {
          // Saga rollback: compensate all previously executed tools
          for (let i = toolResults.length - 2; i >= 0; i--) {
            const prevTool = Array.from(skill.tools.values())[i];
            if (prevTool.compensate) {
              await prevTool.compensate(
                intent as unknown as Record<string, unknown>,
                toolResults[i],
                tenantContext,
              );
            }
          }
          return { success: false, intent, tool_results: toolResults, error: result.error };
        }

        // 5c. Pre-commit constraint check
        const preCommitResults = constraintEngine.evaluate(
          tool.definition.constraints,
          'pre_commit',
          result.data || {},
          tenantConfig,
        );

        if (constraintEngine.hasBlocker(preCommitResults)) {
          const blocker = preCommitResults.find(r => r.verdict === 'fail')!;
          return {
            success: false,
            intent,
            tool_results: toolResults,
            error: `Pre-commit constraint "${blocker.constraint_name}" failed: ${blocker.reason}`,
          };
        }
      }

      // 6. Verification pass (independent check)
      const verificationResult = await verifier.verify(
        {
          intent_description: intent.type,
          proposed_action: toolResults[toolResults.length - 1]?.data || {},
          source_data: intent as unknown as Record<string, unknown>,
          tool_results: toolResults,
        },
        tenantConfig.tenant_id,
      );

      if (!verificationResult.passed) {
        // Rollback all
        return {
          success: false,
          intent,
          tool_results: toolResults,
          verification_passed: false,
          error: `Verification failed: ${verificationResult.checks.filter(c => !c.passed).map(c => c.reason).join('; ')}`,
        };
      }

      // 7. Emit success event
      await emitEvent({
        tenant_id: tenantConfig.tenant_id,
        event_type: `${intent.type}.completed`,
        actor: 'agent',
        action: { intent, tool_results: toolResults },
        verification_result: 'passed',
      });

      return {
        success: true,
        intent,
        tool_results: toolResults,
        verification_passed: true,
      };
    } catch (err) {
      return {
        success: false,
        intent,
        tool_results: [],
        error: `Orchestrator error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}
