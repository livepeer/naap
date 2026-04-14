/**
 * Fee breakdown by capability category.
 * Joins subgraph TranscoderDay volumes with DB orchestrator capability data.
 * Returns time-series array matching the Express backend shape.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken } from '@/lib/api/response';
import { querySubgraph } from '@/lib/wallet/subgraph';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const days = parseInt(request.nextUrl.searchParams.get('days') || '90', 10);

    const capabilities = await prisma.walletOrchestratorCapability.findMany({
      select: { address: true, category: true },
    });

    const capMap = new Map<string, string[]>();
    for (const c of capabilities) {
      const addr = c.address.toLowerCase();
      if (!capMap.has(addr)) capMap.set(addr, []);
      const cats = capMap.get(addr)!;
      if (!cats.includes(c.category)) cats.push(c.category);
    }

    let series: Array<Record<string, number>> = [];
    const allCats = new Set<string>();

    try {
      const data = await querySubgraph<{ transcoderDays: any[] }>(`{
        transcoderDays(
          first: 1000
          orderBy: date
          orderDirection: desc
          where: { volumeETH_gt: "0" }
        ) {
          date
          volumeETH
          transcoder { id }
        }
      }`);

      const cutoffTs = Math.floor((Date.now() - days * 86400000) / 1000);
      const byDateCap = new Map<number, Record<string, number>>();

      for (const td of data.transcoderDays || []) {
        if (td.date < cutoffTs) continue;
        const addr = td.transcoder?.id?.toLowerCase();
        const vol = parseFloat(td.volumeETH);
        if (vol === 0) continue;

        const cats = capMap.get(addr) || ['transcoding'];
        if (!byDateCap.has(td.date)) byDateCap.set(td.date, {});
        const bucket = byDateCap.get(td.date)!;

        const share = vol / cats.length;
        for (const cat of cats) {
          bucket[cat] = (bucket[cat] || 0) + share;
        }
      }

      series = [...byDateCap.entries()]
        .sort(([a], [b]) => a - b)
        .map(([date, caps]) => ({ date: date * 1000, ...caps }));

      for (const row of series) {
        for (const k of Object.keys(row)) {
          if (k !== 'date') allCats.add(k);
        }
      }
    } catch {
      // subgraph unavailable
    }

    return NextResponse.json({ data: { series, categories: [...allCats] } });
  } catch (err) {
    console.error('[network/fees-by-capability] Error:', err);
    return errors.internal('Failed to fetch fees by capability');
  }
}
