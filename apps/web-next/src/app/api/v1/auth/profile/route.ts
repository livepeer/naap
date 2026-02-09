/**
 * Profile API
 * GET   /api/v1/auth/profile - Get current user profile
 * PATCH /api/v1/auth/profile - Update profile (displayName, avatarUrl, bio)
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');

    const sessionUser = await validateSession(token);
    if (!sessionUser) return errors.unauthorized('Invalid or expired session');

    const user = await prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        address: true,
        createdAt: true,
      },
    });

    if (!user) return errors.notFound('User');

    return success({ user });
  } catch (err) {
    console.error('Error fetching profile:', err);
    return errors.internal('Failed to fetch profile');
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');

    const sessionUser = await validateSession(token);
    if (!sessionUser) return errors.unauthorized('Invalid or expired session');

    const body = await request.json();
    const { displayName, avatarUrl, bio } = body;

    // Validation
    if (displayName !== undefined && typeof displayName !== 'string') {
      return errors.badRequest('Display name must be a string');
    }
    if (displayName !== undefined && displayName.trim().length > 50) {
      return errors.badRequest('Display name must be 50 characters or less');
    }
    if (bio !== undefined && typeof bio !== 'string') {
      return errors.badRequest('Bio must be a string');
    }
    if (bio !== undefined && bio.length > 150) {
      return errors.badRequest('Bio must be 150 characters or less');
    }
    if (avatarUrl !== undefined && typeof avatarUrl !== 'string') {
      return errors.badRequest('Avatar URL must be a string');
    }

    const data: Record<string, unknown> = {};
    if (displayName !== undefined) data.displayName = displayName.trim() || null;
    if (avatarUrl !== undefined) data.avatarUrl = avatarUrl.trim() || null;
    if (bio !== undefined) data.bio = bio.trim() || null;

    const updated = await prisma.user.update({
      where: { id: sessionUser.id },
      data,
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        bio: true,
        address: true,
      },
    });

    return success({ user: updated });
  } catch (err) {
    console.error('Error updating profile:', err);
    return errors.internal('Failed to update profile');
  }
}
