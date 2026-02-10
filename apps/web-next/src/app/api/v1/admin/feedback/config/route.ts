/**
 * Admin Feedback Config API
 * GET  /api/v1/admin/feedback/config - Get feedback config
 * PUT  /api/v1/admin/feedback/config - Update feedback config (GitHub issue link, Discord link)
 */

import {NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');

    const sessionUser = await validateSession(token);
    if (!sessionUser) return errors.unauthorized('Invalid or expired session');

    if (!sessionUser.roles.includes('system:admin')) {
      return errors.forbidden('Admin permission required');
    }

    const config = await prisma.feedbackConfig.findFirst();

    return success({
      config: config ?? { githubIssueUrl: '', discordUrl: '' },
    });
  } catch (err) {
    console.error('Error fetching feedback config:', err);
    return errors.internal('Failed to fetch feedback config');
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');

    const sessionUser = await validateSession(token);
    if (!sessionUser) return errors.unauthorized('Invalid or expired session');

    if (!sessionUser.roles.includes('system:admin')) {
      return errors.forbidden('Admin permission required');
    }

    const body = await request.json();
    const { githubIssueUrl, discordUrl } = body;

    // Upsert – only one config row exists
    const existing = await prisma.feedbackConfig.findFirst();

    let config;
    if (existing) {
      config = await prisma.feedbackConfig.update({
        where: { id: existing.id },
        data: {
          ...(githubIssueUrl !== undefined && { githubIssueUrl }),
          ...(discordUrl !== undefined && { discordUrl }),
          updatedBy: sessionUser.id,
        },
      });
    } else {
      config = await prisma.feedbackConfig.create({
        data: {
          githubIssueUrl: githubIssueUrl ?? '',
          discordUrl: discordUrl ?? '',
          updatedBy: sessionUser.id,
        },
      });
    }

    return success({ config });
  } catch (err) {
    console.error('Error updating feedback config:', err);
    return errors.internal('Failed to update feedback config');
  }
}
