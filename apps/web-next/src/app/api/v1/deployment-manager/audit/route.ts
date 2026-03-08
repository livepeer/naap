import { NextRequest } from 'next/server';
import { proxyToBackend } from '@/lib/deployment-manager/proxy';

export async function GET(request: NextRequest) {
  return proxyToBackend(request, '/audit');
}
