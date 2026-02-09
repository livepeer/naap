/**
 * End Daydream Session API Route
 * POST /api/v1/daydream/sessions/:sessionId/end - End a session
 */

import {NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { sessionId } = await params;

    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const csrfError = validateCSRF(request, token);
    if (csrfError) {
      return csrfError;
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    // Find and verify ownership
    const existing = await prisma.daydreamSession.findFirst({
      where: {
        id: sessionId,
        userId: user.id,
      },
    });

    if (!existing) {
      return errors.notFound('Session');
    }

    if (existing.status === 'ended') {
      return success({ session: existing, message: 'Session already ended' });
    }

    // Calculate duration
    const endedAt = new Date();
    const durationMs = endedAt.getTime() - existing.startedAt.getTime();
    const durationMins = durationMs / (1000 * 60);

    const session = await prisma.daydreamSession.update({
      where: { id: sessionId },
      data: {
        status: 'ended',
        endedAt,
        durationMins,
      },
    });

    return success({ session });
  } catch (err) {
    console.error('Error ending session:', err);
    return errors.internal('Failed to end session');
  }
}
