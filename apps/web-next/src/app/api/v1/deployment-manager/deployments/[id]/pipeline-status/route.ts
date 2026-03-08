import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/deployment-manager/proxy';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyToBackend(request, `/deployments/${id}/pipeline-status`);
}
