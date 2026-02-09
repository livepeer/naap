/**
 * Integration Registry
 * Central registry for all available integrations
 */

import type { Integration, IntegrationConfig, IntegrationMetadata } from '../types/integrations.js';

type IntegrationFactory = (config: IntegrationConfig) => Integration;

const integrationFactories = new Map<string, IntegrationFactory>();
const integrationMetadata = new Map<string, IntegrationMetadata>();

/**
 * Register an integration factory
 */
export function registerIntegration(
  type: string,
  factory: IntegrationFactory,
  metadata: IntegrationMetadata
): void {
  integrationFactories.set(type, factory);
  integrationMetadata.set(type, metadata);
}

/**
 * Get an integration instance
 */
export function getIntegration(type: string, config: IntegrationConfig): Integration {
  const factory = integrationFactories.get(type);
  if (!factory) {
    throw new Error(`Integration "${type}" not registered`);
  }
  return factory(config);
}

/**
 * List all registered integrations
 */
export function listIntegrations(): IntegrationMetadata[] {
  return Array.from(integrationMetadata.values());
}

/**
 * Check if an integration is registered
 */
export function hasIntegration(type: string): boolean {
  return integrationFactories.has(type);
}

// Default integration metadata
export const INTEGRATION_METADATA: Record<string, IntegrationMetadata> = {
  'openai': {
    type: 'openai',
    name: 'OpenAI',
    description: 'AI/ML capabilities including GPT models, embeddings, and moderation',
    icon: 'Brain',
    category: 'ai',
    configSchema: {
      fields: {
        apiKey: {
          type: 'string',
          label: 'API Key',
          required: true,
          secret: true,
          placeholder: 'sk-...',
        },
        organization: {
          type: 'string',
          label: 'Organization ID',
          required: false,
          placeholder: 'org-...',
        },
      },
    },
  },
  'anthropic': {
    type: 'anthropic',
    name: 'Anthropic',
    description: 'Claude AI models for text generation and analysis',
    icon: 'MessageSquare',
    category: 'ai',
    configSchema: {
      fields: {
        apiKey: {
          type: 'string',
          label: 'API Key',
          required: true,
          secret: true,
          placeholder: 'sk-ant-...',
        },
      },
    },
  },
  'aws-s3': {
    type: 'aws-s3',
    name: 'AWS S3',
    description: 'Cloud storage for files and assets',
    icon: 'Cloud',
    category: 'storage',
    configSchema: {
      fields: {
        accessKeyId: {
          type: 'string',
          label: 'Access Key ID',
          required: true,
          secret: true,
        },
        secretAccessKey: {
          type: 'string',
          label: 'Secret Access Key',
          required: true,
          secret: true,
        },
        region: {
          type: 'string',
          label: 'Region',
          required: true,
          placeholder: 'us-east-1',
        },
        bucket: {
          type: 'string',
          label: 'Default Bucket',
          required: false,
        },
      },
    },
  },
  'sendgrid': {
    type: 'sendgrid',
    name: 'SendGrid',
    description: 'Email delivery and marketing campaigns',
    icon: 'Mail',
    category: 'email',
    configSchema: {
      fields: {
        apiKey: {
          type: 'string',
          label: 'API Key',
          required: true,
          secret: true,
          placeholder: 'SG...',
        },
        fromEmail: {
          type: 'string',
          label: 'Default From Email',
          required: false,
          placeholder: 'noreply@example.com',
        },
      },
    },
  },
  'stripe': {
    type: 'stripe',
    name: 'Stripe',
    description: 'Payment processing and billing',
    icon: 'CreditCard',
    category: 'payment',
    configSchema: {
      fields: {
        secretKey: {
          type: 'string',
          label: 'Secret Key',
          required: true,
          secret: true,
          placeholder: 'sk_...',
        },
        webhookSecret: {
          type: 'string',
          label: 'Webhook Secret',
          required: false,
          secret: true,
          placeholder: 'whsec_...',
        },
      },
    },
  },
  'twilio': {
    type: 'twilio',
    name: 'Twilio',
    description: 'SMS, Voice, and WhatsApp messaging',
    icon: 'Phone',
    category: 'messaging',
    configSchema: {
      fields: {
        accountSid: {
          type: 'string',
          label: 'Account SID',
          required: true,
          secret: true,
        },
        authToken: {
          type: 'string',
          label: 'Auth Token',
          required: true,
          secret: true,
        },
        phoneNumber: {
          type: 'string',
          label: 'Phone Number',
          required: false,
          placeholder: '+1...',
        },
      },
    },
  },
};
