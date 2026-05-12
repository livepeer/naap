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
    throw new Error('ENCRYPTION_KEY environment variable is required.');
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
  return { encryptedValue, iv: iv.toString('hex') };
}

// POST /api/v1/secrets/[key]/rotate - Rotate a secret's value (admin only)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const auth = await requireAdmin(request);
    if ('error' in auth) return auth.error;

    const { key } = await params;

    let body: { newValue?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (!body.newValue || typeof body.newValue !== 'string') {
      return NextResponse.json({ error: 'newValue (string) is required' }, { status: 400 });
    }

    const secret = await prisma.secretVault.findUnique({ where: { key } });
    if (!secret) {
      return NextResponse.json({ error: 'Secret not found' }, { status: 404 });
    }

    const { encryptedValue, iv } = encrypt(body.newValue);

    const updated = await prisma.secretVault.update({
      where: { key },
      data: {
        encryptedValue,
        iv,
        rotatedAt: new Date(),
      },
      select: {
        id: true,
        key: true,
        description: true,
        scope: true,
        rotatedAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      ...updated,
      message: 'Secret rotated successfully',
    });
  } catch (error) {
    console.error('Error rotating secret:', error);
    return NextResponse.json({ error: 'Failed to rotate secret' }, { status: 500 });
  }
}
