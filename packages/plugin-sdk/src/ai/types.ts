/**
 * AI Plugin Generation Types
 * Types used for parsing plugin specifications and generating code.
 */

/**
 * User Story parsed from plugin.md
 */
export interface UserStory {
  id: string;
  title: string;
  asA: string;           // Role: "team member", "admin", etc.
  iWant: string;         // Action: what the user wants to do
  soThat: string;        // Benefit: why they want to do it
  acceptanceCriteria: AcceptanceCriterion[];
}

export interface AcceptanceCriterion {
  description: string;
  completed: boolean;
}

/**
 * Data Model Field parsed from plugin.md
 */
export interface DataModelField {
  name: string;
  type: string;          // String, Int, Decimal, Boolean, DateTime, Enum, etc.
  optional: boolean;
  relation?: string;     // Reference to another model
  enumValues?: string[]; // For enum types
  default?: string;
  description?: string;
}

/**
 * Data Model parsed from plugin.md
 */
export interface DataModel {
  name: string;
  fields: DataModelField[];
  description?: string;
}

/**
 * Permission definition parsed from plugin.md
 */
export interface Permission {
  role: string;          // team:member, team:admin, team:owner
  actions: string[];     // create, read, update, delete, etc.
  description?: string;
}

/**
 * Integration requirement parsed from plugin.md
 */
export interface Integration {
  name: string;          // storage, ai, email, etc.
  type: string;          // Storage, AI, Notification, etc.
  required: boolean;
  description?: string;
  config?: Record<string, string>;
}

/**
 * Plugin setting parsed from plugin.md
 */
export interface PluginSetting {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  default?: unknown;
  description?: string;
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
    enum?: string[];
  };
}

/**
 * Complete Plugin Specification parsed from plugin.md
 */
export interface PluginSpec {
  name: string;
  displayName: string;
  description: string;
  version: string;
  category?: string;
  userStories: UserStory[];
  dataModel: DataModel[];
  permissions: Permission[];
  integrations: Integration[];
  settings: PluginSetting[];
  rawMarkdown: string;
}

/**
 * Generated file content
 */
export interface GeneratedFile {
  path: string;
  content: string;
  description?: string;
}

/**
 * Generated plugin structure
 */
export interface GeneratedPlugin {
  manifest: Record<string, unknown>;
  dataModel: GeneratedFile[];
  frontend: GeneratedFile[];
  backend: GeneratedFile[];
  tests: GeneratedFile[];
}

/**
 * Code generation options
 */
export interface CodeGenerationOptions {
  spec: PluginSpec;
  outputDir?: string;
  dryRun?: boolean;
  interactive?: boolean;
  skipTests?: boolean;
  skipBackend?: boolean;
  includeDocumentation?: boolean;
}

/**
 * Iteration request for modifying existing plugins
 */
export interface IterationRequest {
  instruction: string;
  spec: PluginSpec;
  currentCode: Map<string, string>;
  targetFile?: string;
  targetStory?: string;
}

/**
 * File change from iteration
 */
export interface FileChange {
  file: string;
  oldContent: string;
  newContent: string;
  diff: string;
  description: string;
}

/**
 * LLM client interface for code generation
 */
export interface LLMClient {
  complete(request: LLMRequest): Promise<string>;
  streamComplete(request: LLMRequest): AsyncIterable<string>;
}

export interface LLMRequest {
  system: string;
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * LLM configuration
 */
export interface LLMConfig {
  provider: 'anthropic' | 'openai' | 'local';
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}
