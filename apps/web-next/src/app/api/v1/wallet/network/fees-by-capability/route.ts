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

    const days = Math.min(
      Math.max(1, parseInt(request.nextUrl.searchParams.get('days') || '30', 10)),
      90,
    );

    const capabilities = await prisma.walletOrchestratorCapability.findMany({
      select: { address: true, category: true },
    });

    const capMap = new Map<string, Set<string>>();
    for (const c of capabilities) {
      const addr = c.address.toLowerCase();
      if (!capMap.has(addr)) capMap.set(addr, new Set());
      capMap.get(addr)!.add(c.category);
    }

    const categories = [...new Set(capabilities.map((c) => c.category))];

    let series: Record<string, number[]> = {};
    try {
      const data = await querySubgraph<{ transcoderDays: any[] }>(`{
        transcoderDays(first: 1000, orderBy: date, orderDirection: desc, where: { date_gte: ${Math.floor(Date.now() / 1000) - days * 86400} }) {
          date transcoder { id } volumeETH
        }
      }`);

      const byCategory: Record<string, Map<number, number>> = {};
      for (const cat of categories) byCategory[cat] = new Map();

      for (const td of data.transcoderDays || []) {
        const addr = td.transcoder?.id?.toLowerCase();
        const caps = capMap.get(addr);
        if (!caps) continue;
        const vol = parseFloat(td.volumeETH || '0');
        for (const cat of caps) {
          const current = byCategory[cat]?.get(td.date) || 0;
          byCategory[cat]?.set(td.date, current + vol);
        }
      }

      for (const cat of categories) {
        const entries = [...(byCategory[cat]?.entries() || [])].sort((a, b) => a[0] - b[0]);
        series[cat] = entries.map(([, v]) => v);
      }
    } catch {
      for (const cat of categories) series[cat] = [];
    }

    return NextResponse.json({ data: { series, categories } });
  } catch (err) {
    console.error('[network/fees-by-capability] Error:', err);
    return errors.internal('Failed to fetch fees by capability');
  }
}
