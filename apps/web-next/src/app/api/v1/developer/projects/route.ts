/**
 * Developer API Projects Routes
 * GET /api/v1/developer/projects - List user's projects
 * POST /api/v1/developer/projects - Create a new project
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    const projects = await prisma.devApiProject.findMany({
      where: { userId: user.id },
      orderBy: [
        { isDefault: 'desc' },
        { name: 'asc' },
      ],
      select: {
        id: true,
        name: true,
        isDefault: true,
        createdAt: true,
      },
    });

    return success({ projects });
  } catch (err) {
    console.error('Projects list error:', err);
    return errors.internal('Failed to list projects');
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
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

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errors.badRequest('Invalid JSON in request body');
    }

    const name = (body.name as string | undefined)?.trim();
    if (!name || name.length === 0) {
      return errors.badRequest('Project name is required');
    }

    if (name.length > 100) {
      return errors.badRequest('Project name must be 100 characters or less');
    }

    const existing = await prisma.devApiProject.findUnique({
      where: {
        userId_name: {
          userId: user.id,
          name,
        },
      },
    });
    if (existing) {
      return errors.badRequest('A project with this name already exists');
    }

    try {
      const project = await prisma.devApiProject.create({
        data: {
          userId: user.id,
          name,
          isDefault: false,
        },
        select: {
          id: true,
          name: true,
          isDefault: true,
          createdAt: true,
        },
      });

      return success({ project });
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') {
        return errors.badRequest('A project with this name already exists');
      }
      throw err;
    }
  } catch (err) {
    console.error('Create project error:', err);
    return errors.internal('Failed to create project');
  }
}
