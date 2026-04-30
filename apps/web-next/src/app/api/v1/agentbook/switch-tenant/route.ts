/**
 * Tenant Switcher — Set ab-tenant cookie to browse as different personas.
 *
 * Usage:
 *   GET /api/v1/agentbook/switch-tenant?id=maya-consultant
 *   GET /api/v1/agentbook/switch-tenant?id=alex-agency
 *   GET /api/v1/agentbook/switch-tenant?id=jordan-sidehustle
 *   GET /api/v1/agentbook/switch-tenant?id=default
 *   GET /api/v1/agentbook/switch-tenant          (shows current + available)
 */
import { NextRequest, NextResponse } from 'next/server';

const PERSONAS: Record<string, { name: string; desc: string; login: string }> = {
  '2e2348b6-a64c-44ad-907e-4ac120ff06f2': { name: 'Maya', desc: 'IT Consultant, Toronto, Canada ($180K CAD)', login: 'maya@agentbook.test' },
  '04b97d95-9c81-4903-817b-9839d504841d': { name: 'Alex', desc: 'Design Agency, Austin TX ($300K USD)', login: 'alex@agentbook.test' },
  '4cbdb620-c84b-44c9-8dbe-8edd64f4e788': { name: 'Jordan', desc: 'Side-Hustle, Portland OR ($35K USD)', login: 'jordan@agentbook.test' },
  'default': { name: 'Default', desc: 'Empty tenant (default)', login: 'admin@a3p.io' },
  // Legacy aliases
  'maya-consultant': { name: 'Maya', desc: 'IT Consultant (alias)', login: 'maya@agentbook.test' },
  'alex-agency': { name: 'Alex', desc: 'Design Agency (alias)', login: 'alex@agentbook.test' },
  'jordan-sidehustle': { name: 'Jordan', desc: 'Side-Hustle (alias)', login: 'jordan@agentbook.test' },
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  const id = request.nextUrl.searchParams.get('id');

  if (!id) {
    const current = request.cookies.get('ab-tenant')?.value || 'default';
    return NextResponse.json({
      current,
      currentPersona: PERSONAS[current] || { name: current, desc: 'Custom tenant' },
      available: Object.entries(PERSONAS).map(([id, p]) => ({
        id, ...p, active: id === current,
        switchUrl: `/api/v1/agentbook/switch-tenant?id=${id}`,
      })),
    });
  }

  const persona = PERSONAS[id];
  const response = NextResponse.json({
    success: true,
    switched: id,
    persona: persona || { name: id, desc: 'Custom tenant' },
    message: `Now browsing as ${persona?.name || id}. Refresh the page.`,
  });

  response.cookies.set('ab-tenant', id, {
    path: '/',
    httpOnly: false, // allow JS to read it
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return response;
}
