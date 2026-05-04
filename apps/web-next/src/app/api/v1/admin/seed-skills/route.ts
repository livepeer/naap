/**
 * One-shot admin: seed AbSkillManifest with the 16 built-in skills.
 *
 * Auth: pass `?secret=…` matching CRON_SECRET. Designed to be hit
 * once after a fresh DB to populate skills, then forgotten.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { BUILT_IN_SKILLS } from '@agentbook-core/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = request.nextUrl.searchParams.get('secret') || request.headers.get('x-admin-secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
  }

  let created = 0;
  let updated = 0;
  for (const skill of BUILT_IN_SKILLS) {
    const existing = await db.abSkillManifest.findFirst({
      where: { tenantId: null, name: skill.name },
    });
    if (existing) {
      await db.abSkillManifest.update({
        where: { id: existing.id },
        data: {
          description: skill.description,
          category: skill.category,
          triggerPatterns: skill.triggerPatterns,
          parameters: skill.parameters as never,
          endpoint: skill.endpoint as never,
          responseTemplate: (skill as { responseTemplate?: string }).responseTemplate || null,
          source: 'built_in',
        },
      });
      updated++;
    } else {
      await db.abSkillManifest.create({
        data: {
          tenantId: null,
          name: skill.name,
          description: skill.description,
          category: skill.category,
          triggerPatterns: skill.triggerPatterns,
          parameters: skill.parameters as never,
          endpoint: skill.endpoint as never,
          responseTemplate: (skill as { responseTemplate?: string }).responseTemplate || null,
          source: 'built_in',
          enabled: true,
        },
      });
      created++;
    }
  }

  return NextResponse.json({
    success: true,
    data: { created, updated, total: BUILT_IN_SKILLS.length },
  });
}
