import {NextRequest, NextResponse } from 'next/server';
import { success, errors } from '@/lib/api/response';

// Available integrations
const INTEGRATIONS = [
  {
    type: 'openai',
    displayName: 'OpenAI',
    category: 'ai',
    description: 'GPT models for AI-powered features',
    configured: false,
  },
  {
    type: 'anthropic',
    displayName: 'Anthropic',
    category: 'ai',
    description: 'Claude AI models',
    configured: false,
  },
  {
    type: 'aws-s3',
    displayName: 'AWS S3',
    category: 'storage',
    description: 'Amazon S3 for file storage',
    configured: false,
  },
  {
    type: 'sendgrid',
    displayName: 'SendGrid',
    category: 'email',
    description: 'Email delivery service',
    configured: false,
  },
  {
    type: 'stripe',
    displayName: 'Stripe',
    category: 'payments',
    description: 'Payment processing',
    configured: false,
  },
  {
    type: 'twilio',
    displayName: 'Twilio',
    category: 'communications',
    description: 'SMS and voice services',
    configured: false,
  },
];

// GET /api/v1/integrations - Get available integrations
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // In production, check which integrations are actually configured
    // by looking at the IntegrationConfig table
    return success({
      integrations: INTEGRATIONS,
    });
  } catch (err) {
    console.error('Error fetching integrations:', err);
    return errors.internal('Failed to fetch integrations');
  }
}
