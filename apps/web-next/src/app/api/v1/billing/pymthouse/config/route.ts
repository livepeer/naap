/**
 * GET /api/v1/billing/pymthouse/config
 * Public PymtHouse integration settings for the Developer API UI (no secrets).
 */

import { NextResponse } from 'next/server';
import {
  isPymthouseConfigured,
  PYMTHOUSE_NOT_CONFIGURED_MESSAGE,
} from '@pymthouse/builder-sdk/config';

import { errors, success } from '@/lib/api/response';
import { resolvePymthouseSignerUrl } from '@/lib/pymthouse-signer-exchange-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  if (!isPymthouseConfigured()) {
    return errors.badRequest(PYMTHOUSE_NOT_CONFIGURED_MESSAGE);
  }

  const signerUrl = resolvePymthouseSignerUrl();
  if (!signerUrl) {
    return errors.badRequest(PYMTHOUSE_NOT_CONFIGURED_MESSAGE);
  }

  const res = success({ signerUrl });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
