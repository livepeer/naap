/**
 * Integrations API Route
 * GET /api/v1/integrations - List available integrations from the database
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

/**
 * Single source of truth for known integration metadata.
 * The IntegrationConfig DB model stores only type, displayName, and configured.
 * displayName, category, and description are enriched from this map so the
 * response shape is consistent regardless of whether DB rows exist.
 */
const INTEGRATION_META: Record<string, { displayName: string; category: string; description: string }> = {
  daydream: { displayName: 'Daydream', category: 'video', description: 'Real-time AI video generation via Daydream' },
  openai: { displayName: 'OpenAI', category: 'ai', description: 'GPT models for AI-powered features' },
  anthropic: { displayName: 'Anthropic', category: 'ai', description: 'Claude AI models' },
  'aws-s3': { displayName: 'AWS S3', category: 'storage', description: 'Amazon S3 for file storage' },
  sendgrid: { displayName: 'SendGrid', category: 'email', description: 'Email delivery service' },
  stripe: { displayName: 'Stripe', category: 'payments', description: 'Payment processing' },
  twilio: { displayName: 'Twilio', category: 'communications', description: 'SMS and voice services' },
};

// Fallback catalogue — returned only when the IntegrationConfig table is empty
// (e.g. fresh deployment before seed). Each entry carries `configured: false`.
const DEFAULT_INTEGRATIONS = Object.entries(INTEGRATION_META).map(([type, meta]) => ({
  type,
  displayName: meta.displayName,
  configured: false,
  category: meta.category,
  description: meta.description,
}));

export async function GET(request: NextRequest): Promise<NextResponse> {
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

    // Check Daydream link status from DaydreamSettings for the current user
    let daydreamConfigured = false;
    const token = getAuthToken(request);
    if (token) {
      const user = await validateSession(token);
      if (user) {
        const settings = await prisma.daydreamSettings.findUnique({
          where: { userId: user.id },
          select: { apiKey: true },
        });
        daydreamConfigured = Boolean(settings?.apiKey);
      }
    }

    const integrations = rows.length > 0
      ? rows.map((r) => {
          const meta = INTEGRATION_META[r.type];
          return {
            type: r.type,
            displayName: r.displayName,
            configured: r.type === 'daydream' ? daydreamConfigured : r.configured,
            category: meta?.category ?? 'other',
            description: meta?.description ?? '',
          };
        })
      : DEFAULT_INTEGRATIONS;

    // Ensure Daydream is always present with correct configured status
    const hasDaydream = integrations.some((i) => i.type === 'daydream');
    if (!hasDaydream) {
      const meta = INTEGRATION_META['daydream'];
      integrations.unshift({
        type: 'daydream',
        displayName: meta.displayName,
        configured: daydreamConfigured,
        category: meta.category,
        description: meta.description,
      });
    } else {
      const dd = integrations.find((i) => i.type === 'daydream');
      if (dd) dd.configured = daydreamConfigured;
    }

    return success({ integrations });
  } catch (err) {
    console.error('Error fetching integrations:', err);
    return errors.internal('Failed to fetch integrations');
  }
}
