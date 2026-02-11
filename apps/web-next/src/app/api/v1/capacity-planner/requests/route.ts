/**
 * Capacity Planner Requests API Route
 * GET  /api/v1/capacity-planner/requests - List capacity requests with filtering
 * POST /api/v1/capacity-planner/requests - Create a new capacity request
 *
 * Uses Prisma for persistence (replaces previous hardcoded mock data).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';
import { validateCSRF } from '@/lib/api/csrf';

/**
 * Serialise a Prisma CapacityRequest (with relations) into the shape
 * the frontend expects (CapacityRequest from @naap/types).
 *
 * Key transformations:
 *  - DateTime → ISO string
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
    startDate: r.startDate.toISOString().split('T')[0],
    endDate: r.endDate.toISOString().split('T')[0],
    validUntil: r.validUntil.toISOString().split('T')[0],
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

    // Build Prisma where clause
    const where: Record<string, unknown> = {};

    if (pipeline) {
      where.pipeline = pipeline;
    }

    if (gpuModel) {
      where.gpuModel = gpuModel;
    }

    if (vramMin) {
      const vramMinNum = parseInt(vramMin, 10);
      if (!isNaN(vramMinNum)) {
        where.vram = { gte: vramMinNum };
      }
    }

    if (search) {
      const q = search;
      where.OR = [
        { requesterName: { contains: q, mode: 'insensitive' } },
        { gpuModel: { contains: q, mode: 'insensitive' } },
        { pipeline: { contains: q, mode: 'insensitive' } },
        { reason: { contains: q, mode: 'insensitive' } },
      ];
    }

    // Build orderBy
    let orderBy: Record<string, string> = { createdAt: 'desc' };
    if (sort === 'newest') orderBy = { createdAt: 'desc' };
    else if (sort === 'gpuCount') orderBy = { count: 'desc' };
    else if (sort === 'hourlyRate') orderBy = { hourlyRate: 'desc' };
    else if (sort === 'riskLevel') orderBy = { riskLevel: 'desc' };
    else if (sort === 'deadline') orderBy = { validUntil: 'asc' };

    const requests = await prisma.capacityRequest.findMany({
      where,
      orderBy,
      include: {
        softCommits: { orderBy: { createdAt: 'desc' } },
        comments: { orderBy: { createdAt: 'desc' } },
      },
    });

    const serialised = requests.map(serialiseRequest);

    // For 'mostCommits' sort, sort in JS after fetching (Prisma can't order by relation count easily)
    if (sort === 'mostCommits') {
      serialised.sort((a, b) => b.softCommits.length - a.softCommits.length);
    }

    return success(serialised);
  } catch (err) {
    console.error('Error fetching capacity requests:', err);
    return errors.internal('Failed to fetch capacity requests');
  }
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

    const created = await prisma.capacityRequest.create({
      data: {
        requesterName: body.requesterName as string,
        requesterAccount: (body.requesterAccount as string) || '0x0000...0000',
        gpuModel: body.gpuModel as string,
        vram: typeof body.vram === 'string' ? parseInt(body.vram as string, 10) : (body.vram as number),
        osVersion: (body.osVersion as string) || 'Any',
        cudaVersion: (body.cudaVersion as string) || 'Any',
        count: typeof body.count === 'string' ? parseInt(body.count as string, 10) : (body.count as number),
        pipeline: body.pipeline as string,
        startDate: new Date(body.startDate as string),
        endDate: new Date(body.endDate as string),
        validUntil: new Date(body.validUntil as string),
        hourlyRate: typeof body.hourlyRate === 'string' ? parseFloat(body.hourlyRate as string) : (body.hourlyRate as number),
        reason: body.reason as string,
        riskLevel: body.riskLevel ? (typeof body.riskLevel === 'string' ? parseInt(body.riskLevel as string, 10) : (body.riskLevel as number)) : 3,
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
