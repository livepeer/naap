/**
 * GET /api/v1/billing/pymthouse/usage
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getUtcCalendarMonthIsoBounds,
  parseUsageDateParam,
} from '@pymthouse/builder-sdk';
import { PmtHouseError, toPmtHouseError } from '@pymthouse/builder-sdk';
import {
  isPymthouseConfigured,
  PYMTHOUSE_NOT_CONFIGURED_MESSAGE,
} from '@pymthouse/builder-sdk/config';

import { validateSession } from '@/lib/api/auth';
import { error, errors, getAuthToken, success } from '@/lib/api/response';
import { getPmtHouseServerClient } from '@/lib/pymthouse-client';

function isSystemAdmin(roles: string[] | undefined): boolean {
  return Boolean(roles?.includes('system:admin'));
}

function stripCryptoUnitFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stripCryptoUnitFields(entry));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  const cryptoUnits = ['wei', 'eth', 'gwei'];
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    // Only drop keys that are exactly a crypto unit or end with one (e.g.
    // "amountWei"), not keys that merely contain the substring (e.g. "method").
    if (cryptoUnits.some((unit) => lowerKey === unit || lowerKey.endsWith(unit))) {
      continue;
    }
    output[key] = stripCryptoUnitFields(entry);
  }
  return output;
}

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
  return error(err.code || 'UPSTREAM_ERROR', 'Upstream service error', err.status ?? 502);
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

    if (Date.parse(startDate) > Date.parse(endDate)) {
      return noStore(errors.badRequest('startDate must be <= endDate'));
    }

    const client = getPmtHouseServerClient();

    if (scopeRaw === 'me') {
      try {
        const body = await client.fetchUsageForExternalUser({
          externalUserId: sessionUser.id,
          startDate,
          endDate,
          includeRetail: true,
        });
        return noStore(success(stripCryptoUnitFields(body)));
      } catch (e) {
        return noStore(mapUpstreamUsageFailure(e));
      }
    }

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
      return noStore(success(stripCryptoUnitFields(usage)));
    } catch (e) {
      return noStore(mapUpstreamUsageFailure(e));
    }
  } catch (err) {
    console.error('[billing:pymthouse:usage] Unexpected error:', err);
    return noStore(errors.internal('Failed to load usage'));
  }
}
