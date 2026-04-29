/**
 * GET /api/v1/billing/pymthouse/usage
 *
 * Session-proxied BFF for PymtHouse Usage API. Defaults to `scope=me` (only the
 * caller's row). `scope=app` is admin-only and returns the raw upstream shape.
 */

import { NextRequest, NextResponse } from 'next/server';
import { PmtHouseError, toPmtHouseError } from '@pymthouse/builder-api';

import { validateSession } from '@/lib/api/auth';
import { error, errors, getAuthToken, success } from '@/lib/api/response';
import { getPmtHouseServerClient } from '@/lib/pymthouse-client';
import {
  isPymthouseConfigured,
  PYMTHOUSE_NOT_CONFIGURED_MESSAGE,
} from '@/lib/pymthouse-env';
import {
  buildMeScopeUsagePayload,
  getUtcCalendarMonthIsoBounds,
  isSystemAdmin,
  parseUsageDateParam,
} from '@/lib/pymthouse-usage-helpers';

function noStore(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

function mapUpstreamUsageFailure(e: unknown): NextResponse {
  const err =
    e instanceof PmtHouseError ? e : toPmtHouseError(e, 'PymtHouse usage request failed');
  if (err.status === 404) {
    return errors.notFound('Usage');
  }
  if (err.status === 400) {
    return errors.badRequest('Invalid usage request');
  }
  if (err.status === 401) {
    return errors.unauthorized();
  }
  if (err.status === 403) {
    return errors.forbidden();
  }
  if (err.status === 429) {
    return errors.tooManyRequests();
  }
  if (err.status >= 500) {
    return errors.serviceUnavailable('Usage data is temporarily unavailable');
  }
  return error(err.code || 'UPSTREAM_ERROR', err.message, err.status);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return noStore(errors.unauthorized('No auth token provided'));
    }

    const sessionUser = await validateSession(token);
    if (!sessionUser) {
      return noStore(errors.unauthorized('Invalid or expired session'));
    }

    if (!isPymthouseConfigured()) {
      return noStore(errors.badRequest(PYMTHOUSE_NOT_CONFIGURED_MESSAGE));
    }

    const sp = request.nextUrl.searchParams;
    const scopeRaw = (sp.get('scope') ?? 'me').trim().toLowerCase();
    if (scopeRaw !== 'me' && scopeRaw !== 'app') {
      return noStore(errors.badRequest('Invalid scope; use me or app'));
    }

    const startRaw = sp.get('startDate');
    const endRaw = sp.get('endDate');
    const startParsed = parseUsageDateParam(startRaw);
    const endParsed = parseUsageDateParam(endRaw);
    const hasStart = startRaw != null && String(startRaw).trim() !== '';
    const hasEnd = endRaw != null && String(endRaw).trim() !== '';

    if (hasStart !== hasEnd) {
      return noStore(
        errors.badRequest('startDate and endDate must both be set or both omitted'),
      );
    }
    if (hasStart && (!startParsed || !endParsed)) {
      return noStore(errors.badRequest('Invalid startDate or endDate'));
    }

    const { startDate, endDate } = hasStart
      ? { startDate: startParsed!, endDate: endParsed! }
      : getUtcCalendarMonthIsoBounds();

    const client = getPmtHouseServerClient();

    if (scopeRaw === 'me') {
      try {
        const usage = await client.getUsage({
          startDate,
          endDate,
          groupBy: 'user',
        });
        const body = buildMeScopeUsagePayload(usage, sessionUser.id);
        return noStore(success(body));
      } catch (e) {
        return noStore(mapUpstreamUsageFailure(e));
      }
    }

    // scope === 'app'
    if (!isSystemAdmin(sessionUser.roles)) {
      return noStore(errors.forbidden('App-wide usage requires system:admin'));
    }

    const groupByRaw = sp.get('groupBy')?.trim();
    let groupBy: 'none' | 'user' | undefined;
    if (groupByRaw) {
      if (groupByRaw !== 'none' && groupByRaw !== 'user') {
        return noStore(errors.badRequest('groupBy must be none or user'));
      }
      groupBy = groupByRaw;
    }

    const userId = sp.get('userId')?.trim() || undefined;

    try {
      const usage = await client.getUsage({
        startDate,
        endDate,
        groupBy,
        userId,
      });
      return noStore(success(usage));
    } catch (e) {
      return noStore(mapUpstreamUsageFailure(e));
    }
  } catch (err) {
    console.error('[billing:pymthouse:usage] Unexpected error:', err);
    return noStore(errors.internal('Failed to load usage'));
  }
}
