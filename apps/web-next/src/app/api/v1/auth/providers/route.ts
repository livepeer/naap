/**
 * GET /api/v1/auth/providers
 * List available OAuth providers
 */

import { getAvailableProviders } from '@/lib/api/auth';
import { success } from '@/lib/api/response';

export async function GET() {
  const providers = getAvailableProviders();

  return success({
    providers,
  });
}
