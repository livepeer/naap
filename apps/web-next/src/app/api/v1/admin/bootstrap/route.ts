/**
 * ONE-TIME admin bootstrap endpoint.
 * Resets admin password and grants admin role to specified users.
 * Protected by a one-time-use secret. DELETE THIS FILE AFTER USE.
 */

export const runtime = 'nodejs';

import * as crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

const BOOTSTRAP_SECRET = process.env.ADMIN_BOOTSTRAP_SECRET;

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 600_000, 64, 'sha256').toString('hex');
  return `pbkdf2-sha256-600k:${salt}:${hash}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!BOOTSTRAP_SECRET) {
    return NextResponse.json({ error: 'Bootstrap not configured' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!body || body.secret !== BOOTSTRAP_SECRET) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const results: string[] = [];

  try {
    if (body.resetAdminPassword) {
      const newPassword = body.resetAdminPassword;
      const passwordHash = hashPassword(newPassword);
      await prisma.user.update({
        where: { email: 'admin@livepeer.org' },
        data: { passwordHash },
      });
      results.push('Admin password reset');
    }

    if (body.grantAdminToEmail) {
      const email = body.grantAdminToEmail;
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        results.push(`User ${email} not found — they need to sign up first`);
      } else {
        const adminRole = await prisma.role.findUnique({ where: { name: 'system:admin' } });
        if (adminRole) {
          await prisma.userRole.upsert({
            where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
            update: {},
            create: { userId: user.id, roleId: adminRole.id, grantedBy: 'bootstrap' },
          });
          results.push(`Granted system:admin to ${email}`);
        }
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
