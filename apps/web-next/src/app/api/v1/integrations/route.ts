/**
 * Integrations API Route
 * GET /api/v1/integrations - List available integrations from the database
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';

// Fallback catalogue — returned only when the IntegrationConfig table is empty
// (e.g. fresh deployment before seed). Each entry carries `configured: false`.
const DEFAULT_INTEGRATIONS = [
  { type: 'openai', displayName: 'OpenAI', category: 'ai', description: 'GPT models for AI-powered features' },
  { type: 'anthropic', displayName: 'Anthropic', category: 'ai', description: 'Claude AI models' },
  { type: 'aws-s3', displayName: 'AWS S3', category: 'storage', description: 'Amazon S3 for file storage' },
  { type: 'sendgrid', displayName: 'SendGrid', category: 'email', description: 'Email delivery service' },
  { type: 'stripe', displayName: 'Stripe', category: 'payments', description: 'Payment processing' },
  { type: 'twilio', displayName: 'Twilio', category: 'communications', description: 'SMS and voice services' },
];

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
        integrations: rows.map((r) => ({
          type: r.type,
          displayName: r.displayName,
          configured: r.configured,
        })),
      });
    }

    // No rows yet — return the default catalogue
    return success({
      integrations: DEFAULT_INTEGRATIONS.map((d) => ({
        ...d,
        configured: false,
      })),
    });
  } catch (err) {
    console.error('Error fetching integrations:', err);
    return errors.internal('Failed to fetch integrations');
  }
}
