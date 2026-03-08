import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/deployment-manager/proxy';

export async function GET(request: NextRequest, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  return proxyToBackend(request, `/artifacts/${type}/latest`);
}
