/**
 * Integration Exports
 */

// Registry
export {
  registerIntegration,
  getIntegration,
  listIntegrations,
  hasIntegration,
  INTEGRATION_METADATA,
} from './registry.js';

// AI Integrations
export { OpenAIIntegration, createOpenAIIntegration } from './ai/openai.js';

// Storage Integrations
export { AWSS3Integration, createS3Integration } from './storage/s3.js';

// Email Integrations
export { SendGridIntegration, createSendGridIntegration } from './email/sendgrid.js';

// Re-export types
export type {
  Integration,
  IntegrationConfig,
  HealthStatus,
  StorageIntegration,
  AIIntegration,
  EmailIntegration,
  PaymentIntegration,
  MessagingIntegration,
  IntegrationMetadata,
} from '../types/integrations.js';
