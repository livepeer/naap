import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import * as crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

function encrypt(text: string): { encryptedValue: string; iv: string } {
  const iv = crypto.randomBytes(16);
  const key = Buffer.from(ENCRYPTION_KEY.slice(0, 32).padEnd(32, '0'));
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return {
    encryptedValue: encrypted + ':' + authTag.toString('hex'),
    iv: iv.toString('hex'),
  };
}

// POST /api/v1/secrets/[key]/rotate - Rotate a secret's value
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await params;
    const body = await request.json();
    const { newValue } = body;

    if (!newValue) {
      return NextResponse.json(
        { error: 'New value is required' },
        { status: 400 }
      );
    }

    const secret = await prisma.secretVault.findUnique({ where: { key } });
    if (!secret) {
      return NextResponse.json(
        { error: 'Secret not found' },
        { status: 404 }
      );
    }

    // Encrypt the new value
    const { encryptedValue, iv } = encrypt(newValue);

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
    return NextResponse.json(
      { error: 'Failed to rotate secret' },
      { status: 500 }
    );
  }
}
