import { NextResponse } from 'next/server';

const PLUGIN_BACKEND = process.env.DEPLOYMENT_MANAGER_URL || 'http://localhost:4117';

export async function GET() {
  try {
    const res = await fetch(`${PLUGIN_BACKEND}/healthz`);
    const data = await res.json();
    return NextResponse.json({ success: true, ...data });
  } catch {
    return NextResponse.json({ success: false, status: 'backend_unreachable' }, { status: 502 });
  }
}
