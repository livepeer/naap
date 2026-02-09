/**
 * AI Plugin Generation Module
 * Exports for parsing specifications and generating plugin code.
 */

// Types
export type {
  PluginSpec,
  UserStory,
  AcceptanceCriterion,
  DataModel,
  DataModelField,
  Permission,
  Integration,
  PluginSetting,
  GeneratedFile,
  GeneratedPlugin,
  CodeGenerationOptions,
  IterationRequest,
  FileChange,
  LLMClient,
  LLMRequest,
  LLMMessage,
  LLMConfig,
} from './types.js';

// Spec Parser
export {
  SpecParser,
  SpecParseError,
  createSpecParser,
} from './specParser.js';

// Code Generator (to be implemented)
export {
  CodeGenerator,
  createCodeGenerator,
} from './codeGenerator.js';

// Prompts
export {
  FRONTEND_SYSTEM_PROMPT,
  BACKEND_SYSTEM_PROMPT,
  TEST_SYSTEM_PROMPT,
  MANIFEST_SYSTEM_PROMPT,
  ITERATE_SYSTEM_PROMPT,
} from './prompts.js';
