/**
 * Integrations API Route
 * GET /api/v1/integrations - List available integrations from the database
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';

/**
 * Static metadata for known integration types.
 * The IntegrationConfig DB model stores only type, displayName, and configured.
 * category and description are enriched from this map so the response shape is
 * consistent regardless of whether DB rows exist.
 */
const INTEGRATION_META: Record<string, { category: string; description: string }> = {
  openai: { category: 'ai', description: 'GPT models for AI-powered features' },
  anthropic: { category: 'ai', description: 'Claude AI models' },
  'aws-s3': { category: 'storage', description: 'Amazon S3 for file storage' },
  sendgrid: { category: 'email', description: 'Email delivery service' },
  stripe: { category: 'payments', description: 'Payment processing' },
  twilio: { category: 'communications', description: 'SMS and voice services' },
};

// Display name overrides for entries that need special casing
const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  'aws-s3': 'AWS S3',
  sendgrid: 'SendGrid',
  stripe: 'Stripe',
  twilio: 'Twilio',
};

// Fallback catalogue — returned only when the IntegrationConfig table is empty
// (e.g. fresh deployment before seed). Each entry carries `configured: false`.
const DEFAULT_INTEGRATIONS = Object.entries(INTEGRATION_META).map(([type, meta]) => ({
  type,
  displayName: DISPLAY_NAME_OVERRIDES[type] ?? type.charAt(0).toUpperCase() + type.slice(1),
  configured: false,
  ...meta,
}));

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const rows = await prisma.integrationConfig.findMany({
      orderBy: { displayName: 'asc' },
      select: {
        type: true,
        displayName: true,
        configured: true,
        // Exclude credentials — never expose secrets to clients
      },
    });

    if (rows.length > 0) {
      return success({
        integrations: rows.map((r) => {
          const meta = INTEGRATION_META[r.type];
          return {
            type: r.type,
            displayName: r.displayName,
            configured: r.configured,
            category: meta?.category ?? 'other',
            description: meta?.description ?? '',
          };
        }),
      });
    }

    // No rows yet — return the default catalogue
    return success({ integrations: DEFAULT_INTEGRATIONS });
  } catch (err) {
    console.error('Error fetching integrations:', err);
    return errors.internal('Failed to fetch integrations');
  }
}
