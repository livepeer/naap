/**
 * @agentbook/framework — Agent orchestration engine
 *
 * Two execution modes:
 * 1. Reactive: user sends message -> intent parse -> skill execution -> response
 * 2. Proactive: scheduler/event -> insight generation -> notification delivery
 *
 * All domain knowledge lives in skills. The framework is generic.
 */

export { Orchestrator } from './orchestrator.js';
export { ConstraintEngine, type Constraint, type ConstraintResult } from './constraint-engine.js';
export { Verifier } from './verifier.js';
export { ContextAssembler, type TenantContext } from './context-assembler.js';
export { EscalationRouter, type Escalation } from './escalation-router.js';
export { SkillRegistry, type Skill, type SkillManifest, type Tool } from './skill-registry.js';
export { EventEmitter, type ExecutionEvent } from './event-emitter.js';
export { ProactiveEngine } from './proactive-engine.js';
export { CalendarEngine, type CalendarEvent, type CalendarProvider } from './calendar-engine.js';
export { type Intent, type ToolResult, type DAGPlan } from './types.js';
