/**
 * Time Tracking — Timer, logging, profitability, auto-invoicing.
 * Following agentbookmvpskill.md patterns: skill decoupled from framework.
 */

export interface TimeEntry {
  id: string;
  projectId?: string;
  clientId?: string;
  description: string;
  startedAt: string;
  endedAt?: string;
  durationMinutes: number;
  hourlyRateCents?: number;
  billable: boolean;
  billed: boolean;
}

export interface TimerState {
  running: boolean;
  entry?: TimeEntry;
}

export interface UnbilledSummary {
  clientId: string;
  clientName: string;
  totalMinutes: number;
  totalHours: number;
  hourlyRateCents: number;
  unbilledAmountCents: number;
  entries: number;
}

export interface ProjectProfitability {
  projectId: string;
  projectName: string;
  clientName: string;
  totalHours: number;
  totalRevenueCents: number;
  effectiveRateCents: number;
  budgetHours: number | null;
  budgetUsedPercent: number | null;
}

export async function startTimer(
  tenantId: string,
  description: string,
  projectId: string | undefined,
  clientId: string | undefined,
  db: any,
): Promise<TimeEntry> {
  // Check for running timer
  const running = await db.abTimeEntry.findFirst({
    where: { tenantId, endedAt: null },
    orderBy: { startedAt: 'desc' },
  });
  if (running) {
    // Auto-stop the running timer
    const duration = Math.round((Date.now() - new Date(running.startedAt).getTime()) / 60000);
    await db.abTimeEntry.update({
      where: { id: running.id },
      data: { endedAt: new Date(), durationMinutes: duration },
    });
  }

  // Get hourly rate from project or client
  let rateCents: number | undefined;
  if (projectId) {
    const project = await db.abProject.findFirst({ where: { id: projectId, tenantId } });
    rateCents = project?.hourlyRateCents ?? undefined;
  }

  const entry = await db.abTimeEntry.create({
    data: {
      tenantId,
      projectId,
      clientId,
      description,
      startedAt: new Date(),
      hourlyRateCents: rateCents,
    },
  });

  return entry;
}

export async function stopTimer(
  tenantId: string,
  db: any,
): Promise<TimeEntry | null> {
  const running = await db.abTimeEntry.findFirst({
    where: { tenantId, endedAt: null },
    orderBy: { startedAt: 'desc' },
  });
  if (!running) return null;

  const duration = Math.round((Date.now() - new Date(running.startedAt).getTime()) / 60000);

  const updated = await db.abTimeEntry.update({
    where: { id: running.id },
    data: { endedAt: new Date(), durationMinutes: Math.max(1, duration) },
  });

  await db.abEvent.create({
    data: {
      tenantId,
      eventType: 'time.logged',
      actor: 'agent',
      action: { entryId: updated.id, durationMinutes: updated.durationMinutes, description: updated.description },
    },
  });

  return updated;
}

export async function logTime(
  tenantId: string,
  description: string,
  minutes: number,
  projectId: string | undefined,
  clientId: string | undefined,
  db: any,
): Promise<TimeEntry> {
  let rateCents: number | undefined;
  if (projectId) {
    const project = await db.abProject.findFirst({ where: { id: projectId, tenantId } });
    rateCents = project?.hourlyRateCents ?? undefined;
  }

  const now = new Date();
  const startedAt = new Date(now.getTime() - minutes * 60000);

  const entry = await db.abTimeEntry.create({
    data: {
      tenantId,
      projectId,
      clientId,
      description,
      startedAt,
      endedAt: now,
      durationMinutes: minutes,
      hourlyRateCents: rateCents,
    },
  });

  await db.abEvent.create({
    data: {
      tenantId,
      eventType: 'time.logged',
      actor: 'human',
      action: { entryId: entry.id, durationMinutes: minutes, description },
    },
  });

  return entry;
}

export async function getUnbilledSummary(
  tenantId: string,
  db: any,
): Promise<UnbilledSummary[]> {
  const entries = await db.abTimeEntry.findMany({
    where: { tenantId, billable: true, billed: false, endedAt: { not: null } },
  });

  // Group by clientId
  const groups: Map<string, { minutes: number; entries: number; rateCents: number }> = new Map();
  for (const e of entries) {
    const key = e.clientId || 'no-client';
    const g = groups.get(key) || { minutes: 0, entries: 0, rateCents: e.hourlyRateCents || 0 };
    g.minutes += e.durationMinutes;
    g.entries += 1;
    if (e.hourlyRateCents) g.rateCents = e.hourlyRateCents;
    groups.set(key, g);
  }

  // Get client names
  const clientIds = Array.from(groups.keys()).filter(k => k !== 'no-client');
  const clients = await db.abClient.findMany({ where: { id: { in: clientIds } } });
  const nameMap = new Map(clients.map((c: any) => [c.id, c.name]));

  return Array.from(groups.entries()).map(([clientId, g]) => ({
    clientId,
    clientName: nameMap.get(clientId) || 'No Client',
    totalMinutes: g.minutes,
    totalHours: Math.round(g.minutes / 6) / 10, // round to 0.1 hours
    hourlyRateCents: g.rateCents,
    unbilledAmountCents: Math.round((g.minutes / 60) * g.rateCents),
    entries: g.entries,
  }));
}

export async function getProjectProfitability(
  tenantId: string,
  db: any,
): Promise<ProjectProfitability[]> {
  const projects = await db.abProject.findMany({
    where: { tenantId },
    include: { timeEntries: true },
  });

  const clientIds = projects.map((p: any) => p.clientId).filter(Boolean);
  const clients = await db.abClient.findMany({ where: { id: { in: clientIds } } });
  const clientNames = new Map(clients.map((c: any) => [c.id, c.name]));

  return projects.map((p: any) => {
    const totalMinutes = p.timeEntries.reduce((s: number, e: any) => s + (e.durationMinutes || 0), 0);
    const totalHours = totalMinutes / 60;
    const rate = p.hourlyRateCents || 0;
    const revenue = Math.round(totalHours * rate);

    return {
      projectId: p.id,
      projectName: p.name,
      clientName: clientNames.get(p.clientId) || 'No Client',
      totalHours: Math.round(totalHours * 10) / 10,
      totalRevenueCents: revenue,
      effectiveRateCents: totalHours > 0 ? Math.round(revenue / totalHours) : 0,
      budgetHours: p.budgetHours,
      budgetUsedPercent: p.budgetHours ? Math.round((totalHours / p.budgetHours) * 100) : null,
    };
  });
}
