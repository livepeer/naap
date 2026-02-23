/**
 * Integrations API Route
 * GET /api/v1/integrations - List available integrations from the database
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';

const INTEGRATION_META: Record<string, { displayName: string; category: string; description: string }> = {
  daydream: { displayName: 'Daydream', category: 'video', description: 'Real-time AI video generation via Daydream' },
  openai: { displayName: 'OpenAI', category: 'ai', description: 'GPT models for AI-powered features' },
  anthropic: { displayName: 'Anthropic', category: 'ai', description: 'Claude AI models' },
  'aws-s3': { displayName: 'AWS S3', category: 'storage', description: 'Amazon S3 for file storage' },
  sendgrid: { displayName: 'SendGrid', category: 'email', description: 'Email delivery service' },
  stripe: { displayName: 'Stripe', category: 'payments', description: 'Payment processing' },
  twilio: { displayName: 'Twilio', category: 'communications', description: 'SMS and voice services' },
};

const DEFAULT_INTEGRATIONS = Object.entries(INTEGRATION_META).map(([type, meta]) => ({
  type,
  displayName: meta.displayName,
  configured: false,
  category: meta.category,
  description: meta.description,
}));

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const rows = await prisma.integrationConfig.findMany({
      orderBy: { displayName: 'asc' },
      select: {
        type: true,
        displayName: true,
        configured: true,
      },
    });

    const integrations = rows.length > 0
      ? rows.map((r) => {
          const meta = INTEGRATION_META[r.type];
          return {
            type: r.type,
            displayName: r.displayName,
            configured: r.configured,
            category: meta?.category ?? 'other',
            description: meta?.description ?? '',
          };
        })
      : DEFAULT_INTEGRATIONS;

    return success({ integrations });
  } catch (err) {
    console.error('Error fetching integrations:', err);
    return errors.internal('Failed to fetch integrations');
  }
}
