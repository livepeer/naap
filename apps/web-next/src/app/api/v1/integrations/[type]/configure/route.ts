import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

// POST /api/v1/integrations/:type/configure - Configure an integration
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  try {
    const { type } = await params;
    const body = await request.json();
    const { credentials } = body;

    if (!type) {
      return errors.badRequest('Integration type is required');
    }

    if (!credentials || Object.keys(credentials).length === 0) {
      return errors.badRequest('Credentials are required');
    }

    // Validate required fields based on integration type
    const requiredFields: Record<string, string[]> = {
      daydream: ['apiKey'],
      openai: ['apiKey'],
      anthropic: ['apiKey'],
      'aws-s3': ['accessKeyId', 'secretAccessKey', 'region'],
      sendgrid: ['apiKey'],
      stripe: ['secretKey'],
      twilio: ['accountSid', 'authToken'],
    };

    const required = requiredFields[type] || ['apiKey'];
    const missing = required.filter(field => !credentials[field]);

    if (missing.length > 0) {
      return errors.badRequest(`Missing required fields: ${missing.join(', ')}`);
    }

    // Daydream: persist API key in DaydreamSettings (per-user)
    if (type === 'daydream') {
      const token = getAuthToken(request);
      if (!token) {
        return errors.unauthorized('Authentication required to link Daydream');
      }
      const user = await validateSession(token);
      if (!user) {
        return errors.unauthorized('Invalid or expired session');
      }

      await prisma.daydreamSettings.upsert({
        where: { userId: user.id },
        update: { apiKey: credentials.apiKey },
        create: {
          userId: user.id,
          apiKey: credentials.apiKey,
        },
      });

      console.log(`Daydream integration linked for user ${user.id}`);
      return success({
        message: 'Daydream account linked successfully',
        configured: true,
      });
    }

    // Other integrations: validate and return success
    // In production, store encrypted credentials in IntegrationConfig table
    console.log(`Configuring integration: ${type}`, Object.keys(credentials));

    return success({
      message: `${type} integration configured successfully`,
      configured: true,
    });
  } catch (err) {
    console.error('Error configuring integration:', err);
    return errors.internal('Failed to configure integration');
  }
}
