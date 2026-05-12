import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken } from '@/lib/api/response';
import * as crypto from 'crypto';

async function requireAdmin(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) return { error: errors.unauthorized('No auth token provided') };
  const user = await validateSession(token);
  if (!user) return { error: errors.unauthorized('Invalid or expired session') };
  if (!user.roles.includes('system:admin')) return { error: errors.forbidden('Admin permission required') };
  return { user };
}

function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is required. ' +
      'Set it in your .env.local or Vercel project settings.'
    );
  }
  return key;
}

function encrypt(text: string): { encryptedValue: string; iv: string } {
  const masterKey = getEncryptionKey();
  const salt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(masterKey, salt, 32, { N: 16384, r: 8, p: 1 });

  const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
  const ct = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const encryptedValue = `v1:gcm:scrypt:${salt.toString('hex')}:${iv.toString('hex')}:${ct.toString('hex')}:${tag.toString('hex')}`;
  return {
    encryptedValue,
    iv: iv.toString('hex'),
  };
}

function maskValue(key: string): string {
  // Show only first 4 chars of key name and mask the rest
  if (key.length <= 4) return '*'.repeat(key.length);
  return key.slice(0, 4) + '*'.repeat(Math.min(key.length - 4, 20));
}

// GET /api/v1/secrets - List all secrets (masked values, admin only)
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireAdmin(request);
    if ('error' in auth) return auth.error;

    const { searchParams } = new URL(request.url);
    const scope = searchParams.get('scope') || 'global';

    const secrets = await prisma.secretVault.findMany({
      where: scope !== 'all' ? { scope } : undefined,
      select: {
        id: true,
        key: true,
        description: true,
        scope: true,
        createdBy: true,
        rotatedAt: true,
        createdAt: true,
        updatedAt: true,
        // Exclude encryptedValue and iv for security
      },
      orderBy: { createdAt: 'desc' },
    });

    // Add masked indicator
    const maskedSecrets = secrets.map((s: { key: string; id: string; description: string | null; scope: string; createdBy: string | null; rotatedAt: Date | null; createdAt: Date; updatedAt: Date }) => ({
      ...s,
      valueMasked: maskValue(s.key),
      hasValue: true,
    }));

    return NextResponse.json({
      secrets: maskedSecrets,
      total: secrets.length,
    });
  } catch (error) {
    console.error('Error fetching secrets:', error);
    return NextResponse.json(
      { error: 'Failed to fetch secrets' },
      { status: 500 }
    );
  }
}

// POST /api/v1/secrets - Create a new secret (admin only)
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requireAdmin(request);
    if ('error' in auth) return auth.error;

    const body = await request.json();
    const { key, value, description, scope = 'global' } = body;

    if (!key || !value) {
      return NextResponse.json(
        { error: 'Key and value are required' },
        { status: 400 }
      );
    }

    // Check if key already exists
    const existing = await prisma.secretVault.findUnique({ where: { key } });
    if (existing) {
      return NextResponse.json(
        { error: 'Secret key already exists' },
        { status: 409 }
      );
    }

    // Encrypt the value
    const { encryptedValue, iv } = encrypt(value);

    const secret = await prisma.secretVault.create({
      data: {
        key,
        encryptedValue,
        iv,
        description,
        scope,
        createdBy: 'system', // In production, get from auth context
      },
      select: {
        id: true,
        key: true,
        description: true,
        scope: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      ...secret,
      message: 'Secret created successfully',
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating secret:', error);
    return NextResponse.json(
      { error: 'Failed to create secret' },
      { status: 500 }
    );
  }
}
