/**
 * Proactive Engagement Engine — The differentiator.
 *
 * Makes AgentBook feel like a professional accounting firm, not a passive app.
 * Runs continuously alongside the reactive path.
 *
 * Three trigger types:
 * - Scheduled: cron-based (daily pulse, weekly review)
 * - Calendar-driven: deadline alerts from CalendarProvider skills
 * - Event-driven: reacts to data changes (payment received, expense recorded)
 * - Analysis-driven: periodic LLM analysis of tenant data
 */

import type { TenantConfig } from './types.js';

export type ProactiveCategory =
  | 'daily_pulse'
  | 'receipt_reminder'
  | 'invoice_followup'
  | 'payment_received'
  | 'recurring_anomaly'
  | 'tax_deadline'
  | 'deduction_hint'
  | 'cash_flow_warning'
  | 'spending_trend'
  | 'weekly_review'
  | 'year_end_planning';

export type ProactiveUrgency = 'critical' | 'important' | 'informational';

export interface ProactiveMessage {
  id: string;
  tenant_id: string;
  category: ProactiveCategory;
  urgency: ProactiveUrgency;
  title_key: string;                 // i18n key
  body_key: string;                  // i18n key
  body_params: Record<string, unknown>;
  actions: ProactiveAction[];
  deliver_at?: string;               // ISO timestamp (null = immediate)
  source_event_id?: string;
  source_skill?: string;
}

export interface ProactiveAction {
  label_key: string;                 // i18n key
  callback_data: string;
  style?: 'primary' | 'secondary' | 'danger';
}

export interface EngagementRecord {
  id: string;
  tenant_id: string;
  message_id: string;
  category: ProactiveCategory;
  urgency: ProactiveUrgency;
  sent_at: string;
  opened_at?: string;
  acted_on_at?: string;
  action_taken?: string;
  snoozed?: boolean;
  dismissed?: boolean;
  response_time_seconds?: number;
}

export type ProactiveDeliveryHandler = (message: ProactiveMessage) => Promise<void>;

/**
 * Priority ranking to prevent notification fatigue.
 */
const URGENCY_RANK: Record<ProactiveUrgency, number> = {
  critical: 3,
  important: 2,
  informational: 1,
};

export class ProactiveEngine {
  private deliveryHandlers: Map<string, ProactiveDeliveryHandler> = new Map();
  private engagementLog: EngagementRecord[] = []; // In-memory for MVP, DB-backed later
  private quietHoursStart = 21; // 9 PM
  private quietHoursEnd = 8;   // 8 AM

  /**
   * Register a delivery channel (e.g., 'telegram', 'web', 'email').
   */
  registerDelivery(channel: string, handler: ProactiveDeliveryHandler): void {
    this.deliveryHandlers.set(channel, handler);
  }

  /**
   * Send a proactive message, respecting quiet hours and priority.
   */
  async send(message: ProactiveMessage, tenantConfig: TenantConfig): Promise<void> {
    // Check quiet hours (in tenant timezone)
    if (this.isQuietHours(tenantConfig.timezone) && message.urgency !== 'critical') {
      // Defer to next morning
      const nextMorning = this.getNextMorning(tenantConfig.timezone);
      message.deliver_at = nextMorning;
      // TODO: Queue for later delivery
      return;
    }

    // Deliver via primary channel (Telegram), fallback to web
    const telegramHandler = this.deliveryHandlers.get('telegram');
    if (telegramHandler) {
      await telegramHandler(message);
    } else {
      const webHandler = this.deliveryHandlers.get('web');
      if (webHandler) {
        await webHandler(message);
      }
    }

    // Log engagement
    this.engagementLog.push({
      id: crypto.randomUUID(),
      tenant_id: message.tenant_id,
      message_id: message.id,
      category: message.category,
      urgency: message.urgency,
      sent_at: new Date().toISOString(),
    });
  }

  /**
   * Record user engagement with a proactive message.
   */
  recordEngagement(messageId: string, action: 'opened' | 'acted_on' | 'snoozed' | 'dismissed', actionTaken?: string): void {
    const record = this.engagementLog.find(r => r.message_id === messageId);
    if (!record) return;

    const now = new Date().toISOString();
    switch (action) {
      case 'opened':
        record.opened_at = now;
        break;
      case 'acted_on':
        record.acted_on_at = now;
        record.action_taken = actionTaken;
        if (record.sent_at) {
          record.response_time_seconds = Math.floor(
            (new Date(now).getTime() - new Date(record.sent_at).getTime()) / 1000
          );
        }
        break;
      case 'snoozed':
        record.snoozed = true;
        break;
      case 'dismissed':
        record.dismissed = true;
        break;
    }
  }

  /**
   * Check if current time is in quiet hours for a timezone.
   */
  private isQuietHours(timezone: string): boolean {
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone });
      const hour = parseInt(formatter.format(now), 10);
      return hour >= this.quietHoursStart || hour < this.quietHoursEnd;
    } catch {
      return false; // If timezone is invalid, don't block
    }
  }

  /**
   * Get next morning timestamp in tenant timezone.
   */
  private getNextMorning(timezone: string): string {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(this.quietHoursEnd, 0, 0, 0);
    return tomorrow.toISOString();
  }
}
