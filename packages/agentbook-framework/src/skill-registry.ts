/**
 * Skill Registry — Discovers, loads, validates, and manages skills.
 *
 * Skills are the domain knowledge layer. The framework is generic.
 * Skills can be hot-reloaded at runtime without restarting the framework.
 */

import type { TenantConfig, ToolResult } from './types.js';
import type { Constraint } from './constraint-engine.js';

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  constraints: string[];         // constraint names to evaluate
  compensation?: string;         // tool name for saga rollback
  model_tier: 'haiku' | 'sonnet' | 'opus';
}

export interface PromptDefinition {
  version: string;
  file: string;                  // relative path to prompt template
  content?: string;              // loaded content (populated at registration)
}

export interface SkillManifest {
  name: string;
  version: string;
  description: string;
  intents: string[];             // intent types this skill handles
  tools: ToolDefinition[];
  prompts: Record<string, PromptDefinition>;
  dependencies: string[];        // other skills this depends on
  calendar_providers?: string[]; // calendar provider tool names
}

export interface Tool {
  name: string;
  skill_name: string;
  definition: ToolDefinition;
  execute: (input: Record<string, unknown>, context: TenantContext) => Promise<ToolResult>;
  compensate?: (input: Record<string, unknown>, output: ToolResult, context: TenantContext) => Promise<void>;
}

export interface Skill {
  manifest: SkillManifest;
  tools: Map<string, Tool>;
  constraints: Constraint[];
}

export interface TenantContext extends TenantConfig {
  // Extended at runtime with loaded context data
  [key: string]: unknown;
}

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private toolIndex: Map<string, Tool> = new Map();        // tool_name -> Tool
  private intentIndex: Map<string, string[]> = new Map();  // intent_type -> skill_names

  /**
   * Register a skill and index its tools and intents.
   */
  register(skill: Skill): void {
    const { manifest } = skill;

    // Validate manifest
    if (!manifest.name || !manifest.version) {
      throw new Error(`Invalid skill manifest: missing name or version`);
    }

    // Check dependencies
    for (const dep of manifest.dependencies) {
      if (!this.skills.has(dep)) {
        throw new Error(`Skill "${manifest.name}" depends on "${dep}" which is not registered`);
      }
    }

    // Register skill
    this.skills.set(manifest.name, skill);

    // Index tools
    for (const [toolName, tool] of skill.tools) {
      this.toolIndex.set(toolName, tool);
    }

    // Index intents
    for (const intent of manifest.intents) {
      const existing = this.intentIndex.get(intent) || [];
      existing.push(manifest.name);
      this.intentIndex.set(intent, existing);
    }
  }

  /**
   * Unregister a skill (for hot-reload).
   */
  unregister(skillName: string): void {
    const skill = this.skills.get(skillName);
    if (!skill) return;

    // Remove tool index entries
    for (const [toolName] of skill.tools) {
      this.toolIndex.delete(toolName);
    }

    // Remove intent index entries
    for (const intent of skill.manifest.intents) {
      const skills = this.intentIndex.get(intent);
      if (skills) {
        this.intentIndex.set(intent, skills.filter(s => s !== skillName));
      }
    }

    this.skills.delete(skillName);
  }

  /**
   * Hot-reload a skill: unregister old version, register new version.
   */
  reload(skill: Skill): void {
    this.unregister(skill.manifest.name);
    this.register(skill);
  }

  /**
   * Resolve a tool by name.
   */
  getTool(toolName: string): Tool | undefined {
    return this.toolIndex.get(toolName);
  }

  /**
   * Get all skills that handle a given intent type.
   */
  getSkillsForIntent(intentType: string): Skill[] {
    const skillNames = this.intentIndex.get(intentType) || [];
    return skillNames.map(name => this.skills.get(name)!).filter(Boolean);
  }

  /**
   * Get a skill by name.
   */
  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * List all registered skills.
   */
  listSkills(): SkillManifest[] {
    return Array.from(this.skills.values()).map(s => s.manifest);
  }

  /**
   * List all registered tools.
   */
  listTools(): ToolDefinition[] {
    return Array.from(this.toolIndex.values()).map(t => t.definition);
  }
}
