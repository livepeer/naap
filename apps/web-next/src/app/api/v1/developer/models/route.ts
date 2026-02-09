/**
 * Developer Models API Routes
 * GET /api/v1/developer/models - List AI models
 */

import { NextRequest } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { models } from '@/lib/data/developer-models';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type');
    const featured = searchParams.get('featured');
    const realtime = searchParams.get('realtime');

    let filtered = [...models];
    
    if (type) {
      filtered = filtered.filter(m => m.type === type);
    }
    if (featured === 'true') {
      filtered = filtered.filter(m => m.featured);
    }
    if (realtime === 'true') {
      filtered = filtered.filter(m => m.realtime);
    }

    return success({
      models: filtered,
      total: filtered.length,
    });
  } catch (err) {
    console.error('Models list error:', err);
    return errors.internal('Failed to list models');
  }
}
