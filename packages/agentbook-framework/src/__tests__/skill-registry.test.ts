import { describe, it, expect } from 'vitest';
import {
  SkillRegistry,
  type Skill,
  type SkillManifest,
  type Tool,
  type ToolDefinition,
  type TenantContext,
} from '../skill-registry.js';

function makeToolDefinition(name: string, overrides?: Partial<ToolDefinition>): ToolDefinition {
  return {
    name,
    description: `Tool ${name}`,
    input_schema: {},
    output_schema: {},
    constraints: [],
    model_tier: 'haiku',
    ...overrides,
  };
}

function makeTool(name: string, skillName: string): Tool {
  const definition = makeToolDefinition(name);
  return {
    name,
    skill_name: skillName,
    definition,
    execute: async () => ({ success: true, idempotency_key: 'key-1' }),
  };
}

function makeSkill(overrides?: Partial<SkillManifest>, tools?: Map<string, Tool>): Skill {
  const manifest: SkillManifest = {
    name: 'test-skill',
    version: '1.0.0',
    description: 'A test skill',
    intents: ['record_expense'],
    tools: [],
    prompts: {},
    dependencies: [],
    ...overrides,
  };

  const toolMap = tools ?? new Map<string, Tool>();
  return {
    manifest,
    tools: toolMap,
    constraints: [],
  };
}

// ---------------------------------------------------------------------------
// register()
// ---------------------------------------------------------------------------
describe('SkillRegistry', () => {
  describe('register()', () => {
    it('adds a skill and indexes tools and intents', () => {
      const registry = new SkillRegistry();
      const tool = makeTool('expense_tool', 'expense-skill');
      const toolMap = new Map([['expense_tool', tool]]);
      const skill = makeSkill(
        { name: 'expense-skill', intents: ['record_expense', 'categorize_expense'] },
        toolMap,
      );

      registry.register(skill);

      // Skill is registered
      expect(registry.getSkill('expense-skill')).toBe(skill);

      // Tool is indexed
      expect(registry.getTool('expense_tool')).toBe(tool);

      // Intents are indexed
      expect(registry.getSkillsForIntent('record_expense')).toHaveLength(1);
      expect(registry.getSkillsForIntent('record_expense')[0]).toBe(skill);
      expect(registry.getSkillsForIntent('categorize_expense')).toHaveLength(1);
    });

    it('throws when a dependency is not registered', () => {
      const registry = new SkillRegistry();
      const skill = makeSkill({ name: 'child-skill', dependencies: ['parent-skill'] });

      expect(() => registry.register(skill)).toThrowError(
        'Skill "child-skill" depends on "parent-skill" which is not registered',
      );
    });

    it('throws when manifest is missing name', () => {
      const registry = new SkillRegistry();
      const skill = makeSkill({ name: '', version: '1.0.0' });

      expect(() => registry.register(skill)).toThrowError('Invalid skill manifest');
    });

    it('throws when manifest is missing version', () => {
      const registry = new SkillRegistry();
      const skill = makeSkill({ name: 'some-skill', version: '' });

      expect(() => registry.register(skill)).toThrowError('Invalid skill manifest');
    });

    it('succeeds when dependencies are already registered', () => {
      const registry = new SkillRegistry();
      const parent = makeSkill({ name: 'parent-skill' });
      const child = makeSkill({ name: 'child-skill', dependencies: ['parent-skill'] });

      registry.register(parent);
      expect(() => registry.register(child)).not.toThrow();
      expect(registry.getSkill('child-skill')).toBe(child);
    });
  });

  // ---------------------------------------------------------------------------
  // unregister()
  // ---------------------------------------------------------------------------
  describe('unregister()', () => {
    it('removes skill, tools, and intents', () => {
      const registry = new SkillRegistry();
      const tool = makeTool('my_tool', 'my-skill');
      const toolMap = new Map([['my_tool', tool]]);
      const skill = makeSkill(
        { name: 'my-skill', intents: ['record_expense'] },
        toolMap,
      );

      registry.register(skill);
      expect(registry.getSkill('my-skill')).toBeDefined();
      expect(registry.getTool('my_tool')).toBeDefined();

      registry.unregister('my-skill');

      expect(registry.getSkill('my-skill')).toBeUndefined();
      expect(registry.getTool('my_tool')).toBeUndefined();
      expect(registry.getSkillsForIntent('record_expense')).toHaveLength(0);
    });

    it('does nothing when skill does not exist', () => {
      const registry = new SkillRegistry();
      expect(() => registry.unregister('nonexistent')).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // reload()
  // ---------------------------------------------------------------------------
  describe('reload()', () => {
    it('unregisters old version and registers new version', () => {
      const registry = new SkillRegistry();
      const oldTool = makeTool('old_tool', 'reloadable');
      const oldMap = new Map([['old_tool', oldTool]]);
      const oldSkill = makeSkill(
        { name: 'reloadable', version: '1.0.0', intents: ['record_expense'] },
        oldMap,
      );

      registry.register(oldSkill);
      expect(registry.getTool('old_tool')).toBeDefined();

      const newTool = makeTool('new_tool', 'reloadable');
      const newMap = new Map([['new_tool', newTool]]);
      const newSkill = makeSkill(
        { name: 'reloadable', version: '2.0.0', intents: ['categorize_expense'] },
        newMap,
      );

      registry.reload(newSkill);

      // Old tool gone, new tool present
      expect(registry.getTool('old_tool')).toBeUndefined();
      expect(registry.getTool('new_tool')).toBeDefined();

      // Old intent gone, new intent present
      expect(registry.getSkillsForIntent('record_expense')).toHaveLength(0);
      expect(registry.getSkillsForIntent('categorize_expense')).toHaveLength(1);

      // Manifest updated
      expect(registry.getSkill('reloadable')?.manifest.version).toBe('2.0.0');
    });
  });

  // ---------------------------------------------------------------------------
  // getTool()
  // ---------------------------------------------------------------------------
  describe('getTool()', () => {
    it('returns tool by name', () => {
      const registry = new SkillRegistry();
      const tool = makeTool('lookup_tool', 'skill-a');
      const toolMap = new Map([['lookup_tool', tool]]);
      registry.register(makeSkill({ name: 'skill-a' }, toolMap));

      expect(registry.getTool('lookup_tool')).toBe(tool);
    });

    it('returns undefined for unknown tool', () => {
      const registry = new SkillRegistry();
      expect(registry.getTool('nonexistent')).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getSkillsForIntent()
  // ---------------------------------------------------------------------------
  describe('getSkillsForIntent()', () => {
    it('returns matching skills for an intent', () => {
      const registry = new SkillRegistry();
      const skillA = makeSkill({ name: 'skill-a', intents: ['record_expense'] });
      const skillB = makeSkill({ name: 'skill-b', intents: ['record_expense', 'create_invoice'] });

      registry.register(skillA);
      registry.register(skillB);

      const matching = registry.getSkillsForIntent('record_expense');
      expect(matching).toHaveLength(2);
    });

    it('returns empty array for unknown intent', () => {
      const registry = new SkillRegistry();
      expect(registry.getSkillsForIntent('unknown_intent')).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // listSkills() and listTools()
  // ---------------------------------------------------------------------------
  describe('listSkills()', () => {
    it('returns all registered skill manifests', () => {
      const registry = new SkillRegistry();
      registry.register(makeSkill({ name: 'skill-a' }));
      registry.register(makeSkill({ name: 'skill-b' }));

      const manifests = registry.listSkills();
      expect(manifests).toHaveLength(2);
      const names = manifests.map(m => m.name);
      expect(names).toContain('skill-a');
      expect(names).toContain('skill-b');
    });
  });

  describe('listTools()', () => {
    it('returns all registered tool definitions', () => {
      const registry = new SkillRegistry();
      const toolA = makeTool('tool_a', 'skill-a');
      const toolB = makeTool('tool_b', 'skill-b');
      registry.register(makeSkill({ name: 'skill-a' }, new Map([['tool_a', toolA]])));
      registry.register(makeSkill({ name: 'skill-b' }, new Map([['tool_b', toolB]])));

      const tools = registry.listTools();
      expect(tools).toHaveLength(2);
      const names = tools.map(t => t.name);
      expect(names).toContain('tool_a');
      expect(names).toContain('tool_b');
    });
  });
});
