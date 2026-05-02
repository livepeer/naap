/**
 * AgentBook Invoice — Vercel Function host for the plugin Express app.
 */

import 'server-only';
import { makeRouteHandler } from '@/lib/agentbook-route-host';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const handler = makeRouteHandler('agentbook-invoice', () =>
  import('@naap/plugin-agentbook-invoice-backend') as unknown as Promise<{ app: any }>
);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
