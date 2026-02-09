import { NextRequest } from 'next/server';
import { success, errors } from '@/lib/api/response';

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

    // In production, store encrypted credentials in IntegrationConfig table
    // For now, just validate and return success
    console.log(`Configuring integration: ${type}`, Object.keys(credentials));

    // Validate required fields based on integration type
    const requiredFields: Record<string, string[]> = {
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

    return success({
      message: `${type} integration configured successfully`,
      configured: true,
    });
  } catch (err) {
    console.error('Error configuring integration:', err);
    return errors.internal('Failed to configure integration');
  }
}
