import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/deployment-manager/proxy';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ providerId: string }> }) {
  const { providerId } = await params;
  return proxyToBackend(request, `/credentials/${providerId}/credentials`);
}
