/**
 * Admin Users API
 * GET /api/v1/admin/users - List all users (admin only)
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const sessionUser = await validateSession(token);
    if (!sessionUser) {
      return errors.unauthorized('Invalid or expired session');
    }

    // Check admin permission
    const isAdmin = sessionUser.roles.includes('system:admin');
    if (!isAdmin) {
      return errors.forbidden('Admin permission required');
    }

    const usersData = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        address: true,
        emailVerified: true,
        createdAt: true,
        userRoles: {
          select: {
            role: {
              select: {
                name: true,
              },
            },
          },
        },
        _count: {
          select: {
            teamMemberships: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Transform the data to include roles as an array of strings
    const users = usersData.map(user => ({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      walletAddress: user.address,
      roles: user.userRoles.map(ur => ur.role.name),
      emailVerified: !!user.emailVerified,
      createdAt: user.createdAt,
      lastLoginAt: null, // Not tracked in this schema
      _count: user._count,
    }));

    return success({ users });
  } catch (err) {
    console.error('Error fetching users:', err);
    return errors.internal('Failed to fetch users');
  }
}
