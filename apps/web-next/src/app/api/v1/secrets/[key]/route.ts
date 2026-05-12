import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken } from '@/lib/api/response';

async function requireAdmin(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) return { error: errors.unauthorized('No auth token provided') };
  const user = await validateSession(token);
  if (!user) return { error: errors.unauthorized('Invalid or expired session') };
  if (!user.roles.includes('system:admin')) return { error: errors.forbidden('Admin permission required') };
  return { user };
}

// DELETE /api/v1/secrets/[key] - Delete a secret (admin only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const auth = await requireAdmin(request);
    if ('error' in auth) return auth.error;

    const { key } = await params;

    const secret = await prisma.secretVault.findUnique({ where: { key } });
    if (!secret) {
      return NextResponse.json(
        { error: 'Secret not found' },
        { status: 404 }
      );
    }

    await prisma.secretVault.delete({ where: { key } });

    return NextResponse.json({
      success: true,
      message: `Secret '${key}' deleted successfully`,
    });
  } catch (error) {
    console.error('Error deleting secret:', error);
    return NextResponse.json(
      { error: 'Failed to delete secret' },
      { status: 500 }
    );
  }
}

// GET /api/v1/secrets/[key] - Get secret metadata (admin only)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const auth = await requireAdmin(request);
    if ('error' in auth) return auth.error;

    const { key } = await params;

    const secret = await prisma.secretVault.findUnique({
      where: { key },
      select: {
        id: true,
        key: true,
        description: true,
        scope: true,
        createdBy: true,
        rotatedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!secret) {
      return NextResponse.json(
        { error: 'Secret not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ...secret,
      hasValue: true,
      valueMasked: '****',
    });
  } catch (error) {
    console.error('Error fetching secret:', error);
    return NextResponse.json(
      { error: 'Failed to fetch secret' },
      { status: 500 }
    );
  }
}
