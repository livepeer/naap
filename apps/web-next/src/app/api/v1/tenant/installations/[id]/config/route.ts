import { NextRequest } from 'next/server';
import { success, errors } from '@/lib/api/response';

/** Sanitize a value for safe log output (prevents log injection) */
function sanitizeForLog(value: unknown): string {
  return String(value).replace(/[\n\r\t\x00-\x1f\x7f-\x9f]/g, '');
}

// PUT /api/v1/tenant/installations/:id/config - Update installation config
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { settings } = body;

    if (!id) {
      return errors.badRequest('Installation ID is required');
    }

    // In production, update the installation config in database
    console.log(`Updating config for installation ${sanitizeForLog(id)}:`, settings);

    return success({
      message: 'Configuration saved successfully',
      config: { settings },
    });
  } catch (err) {
    console.error('Error updating installation config:', err);
    return errors.internal('Failed to update configuration');
  }
}

// GET /api/v1/tenant/installations/:id/config - Get installation config
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return errors.badRequest('Installation ID is required');
    }

    // In production, fetch from database
    return success({
      config: {
        settings: {},
      },
    });
  } catch (err) {
    console.error('Error fetching installation config:', err);
    return errors.internal('Failed to fetch configuration');
  }
}
