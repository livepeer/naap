/**
 * Capacity Planner Requests API Route
 * GET  /api/v1/capacity-planner/requests - List capacity requests with filtering
 * POST /api/v1/capacity-planner/requests - Create a new capacity request
 *
 * Uses Prisma for persistence (replaces previous hardcoded mock data).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { Prisma } from '@naap/database';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';
import { validateCSRF } from '@/lib/api/csrf';

/**
 * Serialise a Prisma CapacityRequest (with relations) into the shape
 * the frontend expects (CapacityRequest from @naap/types).
 *
 * Key transformations:
 *  - DateTime → ISO string (dates formatted as YYYY-MM-DD in UTC)
 *  - Enum status (ACTIVE) → lowercase ('active')
 *  - SoftCommit.createdAt → timestamp
 */
function serialiseRequest(r: {
  id: string;
  requesterName: string;
  requesterAccount: string;
  gpuModel: string;
  vram: number;
  osVersion: string;
  cudaVersion: string;
  count: number;
  pipeline: string;
  startDate: Date;
  endDate: Date;
  validUntil: Date;
  hourlyRate: number;
  reason: string;
  riskLevel: number;
  status: string;
  createdAt: Date;
  softCommits?: Array<{
    id: string;
    userId: string;
    userName: string;
    createdAt: Date;
  }>;
  comments?: Array<{
    id: string;
    author: string;
    text: string;
    createdAt: Date;
  }>;
}) {
  /** Format a Date as UTC YYYY-MM-DD to avoid timezone off-by-one issues. */
  const toDateString = (d: Date): string => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  return {
    id: r.id,
    requesterName: r.requesterName,
    requesterAccount: r.requesterAccount,
    gpuModel: r.gpuModel,
    vram: r.vram,
    osVersion: r.osVersion,
    cudaVersion: r.cudaVersion,
    count: r.count,
    pipeline: r.pipeline,
    startDate: toDateString(r.startDate),
    endDate: toDateString(r.endDate),
    validUntil: toDateString(r.validUntil),
    hourlyRate: r.hourlyRate,
    reason: r.reason,
    riskLevel: r.riskLevel,
    status: r.status.toLowerCase(),
    createdAt: r.createdAt.toISOString(),
    softCommits: (r.softCommits ?? []).map((sc) => ({
      id: sc.id,
      userId: sc.userId,
      userName: sc.userName,
      timestamp: sc.createdAt.toISOString(),
    })),
    comments: (r.comments ?? []).map((c) => ({
      id: c.id,
      author: c.author,
      text: c.text,
      timestamp: c.createdAt.toISOString(),
    })),
  };
}

/**
 * GET /api/v1/capacity-planner/requests
 * Returns all capacity requests from the database with optional filtering.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const pipeline = searchParams.get('pipeline');
    const gpuModel = searchParams.get('gpuModel');
    const search = searchParams.get('search');
    const vramMin = searchParams.get('vramMin');
    const sort = searchParams.get('sort');

    // Build Prisma where clause with proper types
    const where: Prisma.CapacityRequestWhereInput = {};

    if (pipeline) {
      where.pipeline = pipeline;
    }

    if (gpuModel) {
      where.gpuModel = gpuModel;
    }

    if (vramMin) {
      const vramMinNum = parseInt(vramMin, 10);
      if (Number.isFinite(vramMinNum)) {
        where.vram = { gte: vramMinNum };
      }
    }

    if (search) {
      where.OR = [
        { requesterName: { contains: search, mode: 'insensitive' } },
        { gpuModel: { contains: search, mode: 'insensitive' } },
        { pipeline: { contains: search, mode: 'insensitive' } },
        { reason: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Build orderBy with proper Prisma type
    let orderBy: Prisma.CapacityRequestOrderByWithRelationInput = { createdAt: 'desc' };
    if (sort === 'newest') orderBy = { createdAt: 'desc' };
    else if (sort === 'gpuCount') orderBy = { count: 'desc' };
    else if (sort === 'hourlyRate') orderBy = { hourlyRate: 'desc' };
    else if (sort === 'riskLevel') orderBy = { riskLevel: 'desc' };
    else if (sort === 'deadline') orderBy = { validUntil: 'asc' };
    else if (sort === 'mostCommits') {
      // Prisma supports ordering by relation count via _count
      orderBy = { softCommits: { _count: 'desc' } };
    }

    const requests = await prisma.capacityRequest.findMany({
      where,
      orderBy,
      include: {
        softCommits: { orderBy: { createdAt: 'desc' } },
        comments: { orderBy: { createdAt: 'desc' } },
      },
    });

    return success(requests.map(serialiseRequest));
  } catch (err) {
    console.error('Error fetching capacity requests:', err);
    return errors.internal('Failed to fetch capacity requests');
  }
}

/** Parse a numeric value from the request body, accepting both string and number. */
function parseNum(value: unknown, fallback?: number): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return fallback;
}

/** Parse a date string and validate it is a real date. */
function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * POST /api/v1/capacity-planner/requests
 * Create a new capacity request and persist it to the database.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Authenticate
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const csrfError = validateCSRF(request, token);
    if (csrfError) {
      return csrfError;
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    // Parse body — catch malformed JSON explicitly
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errors.badRequest('Invalid JSON in request body');
    }

    // Validate required fields
    const requiredFields = ['requesterName', 'gpuModel', 'vram', 'count', 'pipeline', 'startDate', 'endDate', 'validUntil', 'hourlyRate', 'reason'];
    for (const field of requiredFields) {
      if (body[field] === undefined || body[field] === null || body[field] === '') {
        return errors.badRequest(`Missing required field: ${field}`);
      }
    }

    // Parse and validate numeric fields
    const vram = parseNum(body.vram);
    const count = parseNum(body.count);
    const hourlyRate = parseNum(body.hourlyRate);
    const riskLevel = parseNum(body.riskLevel, 3);

    if (vram === undefined || count === undefined || hourlyRate === undefined) {
      return errors.badRequest('vram, count, and hourlyRate must be valid numbers');
    }

    // Parse and validate date fields
    const startDate = parseDate(body.startDate);
    const endDate = parseDate(body.endDate);
    const validUntil = parseDate(body.validUntil);

    if (!startDate || !endDate || !validUntil) {
      return errors.badRequest('startDate, endDate, and validUntil must be valid date strings');
    }

    const created = await prisma.capacityRequest.create({
      data: {
        requesterName: body.requesterName as string,
        requesterAccount: (body.requesterAccount as string) || '0x0000...0000',
        gpuModel: body.gpuModel as string,
        vram,
        osVersion: (body.osVersion as string) || 'Any',
        cudaVersion: (body.cudaVersion as string) || 'Any',
        count,
        pipeline: body.pipeline as string,
        startDate,
        endDate,
        validUntil,
        hourlyRate,
        reason: body.reason as string,
        riskLevel: riskLevel ?? 3,
        status: 'ACTIVE',
      },
      include: {
        softCommits: true,
        comments: true,
      },
    });

    return NextResponse.json(
      { success: true, data: serialiseRequest(created) },
      { status: 201 }
    );
  } catch (err) {
    console.error('Error creating capacity request:', err);
    return errors.internal('Failed to create capacity request');
  }
}
