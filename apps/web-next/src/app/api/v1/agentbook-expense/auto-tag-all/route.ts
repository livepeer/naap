/**
 * Bulk auto-tag — apply regex tagging rules to up to 500 untagged
 * expenses for the tenant.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const TAG_RULES: [RegExp, string][] = [
  [/restaurant|cafe|coffee|starbucks|mcdonald|chipotle|uchi|canoe|alo|dinner|lunch|breakfast|food|eat/i, 'meals'],
  [/uber|lyft|taxi|cab|transit/i, 'transportation'],
  [/hotel|marriott|hyatt|hilton|airbnb/i, 'accommodation'],
  [/air canada|westjet|delta|united|flight|airline/i, 'flights'],
  [/adobe|figma|slack|notion|github|asana|shopify|grammarly|wordpress|aws/i, 'software'],
  [/apple|dell|wacom|samsung|monitor|laptop/i, 'equipment'],
  [/insurance|manulife|hiscox/i, 'insurance'],
  [/rent|lease|wework|cowork/i, 'rent'],
  [/phone|internet|bell|comcast/i, 'telecom'],
  [/usps|fedex|ups|shipping|postage/i, 'shipping'],
  [/google ads|facebook ads|marketing|advertising/i, 'marketing'],
  [/contractor|freelance/i, 'contractor'],
  [/costco|walmart|target|staples|supplies/i, 'supplies'],
  [/training|course|udemy|workshop|conference/i, 'education'],
  [/netflix|spotify|entertainment/i, 'entertainment'],
  [/grocery|trader|whole foods/i, 'groceries'],
];

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const expenses = await db.abExpense.findMany({
      where: { tenantId, tags: null },
      include: { vendor: true },
      take: 500,
    });

    let tagged = 0;
    for (const exp of expenses) {
      const vn = (exp.vendor?.name || exp.description || '').toLowerCase();
      const tags: string[] = [];
      for (const [pattern, tag] of TAG_RULES) {
        if (pattern.test(vn)) tags.push(tag);
      }
      if (exp.amountCents > 100000) tags.push('high-value');
      if (tags.length > 0) {
        await db.abExpense.update({ where: { id: exp.id }, data: { tags: tags.join(',') } });
        tagged++;
      }
    }

    return NextResponse.json({ success: true, data: { checked: expenses.length, tagged } });
  } catch (err) {
    console.error('[agentbook-expense/auto-tag-all] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
