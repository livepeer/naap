/**
 * Calendar & Deadline Engine — Always on the clock.
 *
 * Maintains a living calendar of every date that matters for each tenant.
 * Deadlines are discovered by skills via CalendarProvider tools, not hardcoded config.
 *
 * Skills register calendar providers. The engine queries them periodically.
 * New jurisdiction pack = new deadlines auto-appear. No code changes.
 */

export interface CalendarEvent {
  id: string;
  tenant_id: string;
  event_type: 'tax_deadline' | 'filing_deadline' | 'quarter_close' | 'market_holiday'
    | 'invoice_due' | 'renewal' | 'cash_crunch' | 'custom';
  title_key: string;                  // i18n key
  date: string;                       // ISO date
  time?: string;                      // ISO time (optional)
  lead_time_days: number[];           // e.g., [7, 3, 1, 0] = alert at 7d, 3d, 1d, day-of
  urgency: 'critical' | 'important' | 'informational';
  action_url?: string;                // deep link (e.g., IRS Direct Pay)
  action_label_key?: string;          // i18n key for button
  recurrence: 'annual' | 'quarterly' | 'monthly' | 'once';
  source_skill: string;               // which skill created this event
  source_entity_id?: string;          // invoice_id, pattern_id, etc.
  status: 'upcoming' | 'alerted' | 'acted_on' | 'missed' | 'snoozed';
}

export interface CalendarProvider {
  name: string;
  skill: string;
  refresh_interval: 'hourly' | 'daily' | 'weekly' | 'on_event';
  getEvents(tenantId: string, dateRange: { start: string; end: string }): Promise<CalendarEvent[]>;
}

export class CalendarEngine {
  private providers: Map<string, CalendarProvider> = new Map();
  private events: Map<string, CalendarEvent[]> = new Map(); // tenant_id -> events (in-memory for MVP)

  /**
   * Register a calendar provider (skills call this during initialization).
   */
  registerProvider(provider: CalendarProvider): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * Refresh calendar for a tenant by querying all providers.
   */
  async refresh(tenantId: string): Promise<void> {
    const now = new Date();
    const threeMonthsOut = new Date(now);
    threeMonthsOut.setMonth(threeMonthsOut.getMonth() + 3);

    const dateRange = {
      start: now.toISOString().split('T')[0],
      end: threeMonthsOut.toISOString().split('T')[0],
    };

    const allEvents: CalendarEvent[] = [];

    for (const [, provider] of this.providers) {
      try {
        const events = await provider.getEvents(tenantId, dateRange);
        allEvents.push(...events);
      } catch (err) {
        console.error(`Calendar provider "${provider.name}" failed for tenant ${tenantId}:`, err);
      }
    }

    this.events.set(tenantId, allEvents);
  }

  /**
   * Get events that need alerting now (based on lead_time_days).
   * Called by proactive engine on hourly cron.
   */
  getAlertableEvents(tenantId: string): CalendarEvent[] {
    const events = this.events.get(tenantId) || [];
    const now = new Date();
    const alertable: CalendarEvent[] = [];

    for (const event of events) {
      if (event.status !== 'upcoming') continue;

      const eventDate = new Date(event.date);
      const daysUntil = Math.ceil((eventDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      // Check if any lead time matches
      if (event.lead_time_days.includes(daysUntil) || (daysUntil <= 0 && event.lead_time_days.includes(0))) {
        alertable.push(event);
      }
    }

    return alertable;
  }

  /**
   * Mark an event as alerted/acted_on/snoozed.
   */
  updateEventStatus(tenantId: string, eventId: string, status: CalendarEvent['status']): void {
    const events = this.events.get(tenantId) || [];
    const event = events.find(e => e.id === eventId);
    if (event) {
      event.status = status;
    }
  }

  /**
   * Get all upcoming events for a tenant (for dashboard display).
   */
  getUpcomingEvents(tenantId: string, limit: number = 20): CalendarEvent[] {
    const events = this.events.get(tenantId) || [];
    return events
      .filter(e => e.status === 'upcoming' || e.status === 'alerted')
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(0, limit);
  }
}
