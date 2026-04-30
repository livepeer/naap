/**
 * Calendar Check Cron — Checks deadlines and fires alerts.
 * Vercel cron: "0 * * * *" (every hour)
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';


export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    let alertsFired = 0;

    // Find all calendar events that need alerting:
    // - Event date is within the lead-time window
    // - Alert has not already been sent
    const upcomingEvents = await db.abCalendarEvent.findMany({
      where: {
        alertSent: false,
        date: {
          gte: now,
          lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000), // Next 7 days
        },
      },
      orderBy: { date: 'asc' },
    });

    for (const event of upcomingEvents) {
      const hoursUntil = (event.date.getTime() - now.getTime()) / (1000 * 60 * 60);
      const leadHours = event.leadTimeDays ? event.leadTimeDays * 24 : 48; // Default 2 days lead

      // Only fire alert if we're within the lead time window
      if (hoursUntil > leadHours) continue;

      // Mark as alerted
      await db.abCalendarEvent.update({
        where: { id: event.id },
        data: { alertSent: true },
      });

      // Create event for proactive engine to pick up and deliver via Telegram
      await db.abEvent.create({
        data: {
          tenantId: event.tenantId,
          eventType: 'proactive.calendar_alert',
          actor: 'system',
          action: {
            calendarEventId: event.id,
            title: event.title,
            date: event.date.toISOString(),
            eventType: event.eventType,
            hoursUntil: Math.round(hoursUntil),
          },
        },
      });

      alertsFired++;
    }

    return NextResponse.json({
      success: true,
      alertsFired,
      eventsChecked: upcomingEvents.length,
      timestamp: now.toISOString(),
    });
  } catch (err) {
    console.error('Calendar check cron error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
