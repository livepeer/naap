/**
 * Journal entries are immutable — PUT / PATCH / DELETE all 403.
 * Corrections are made via reversing entries, never by editing existing
 * records (per the AgentBook constraint engine).
 */

import 'server-only';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const reject = () =>
  NextResponse.json(
    {
      success: false,
      error: 'Journal entries are immutable. Create a reversing entry instead.',
      constraint: 'immutability_invariant',
    },
    { status: 403 },
  );

export async function PUT(): Promise<NextResponse> { return reject(); }
export async function PATCH(): Promise<NextResponse> { return reject(); }
export async function DELETE(): Promise<NextResponse> { return reject(); }
