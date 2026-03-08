import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/deployment-manager/proxy';

export async function GET(request: NextRequest, { params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  return proxyToBackend(request, `/templates/${templateId}/versions`);
}
