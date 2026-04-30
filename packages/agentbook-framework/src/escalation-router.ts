/**
 * Escalation Router — Human-in-the-loop decision routing.
 *
 * Escalation decisions are based on deterministic rules, not LLM judgment.
 * Every escalation includes: what, why, recommendation, alternatives, action buttons.
 */

export interface Escalation {
  id: string;
  tenant_id: string;
  action_type: string;
  action_data: Record<string, unknown>;
  reasoning: string;
  recommendation: string;
  alternatives: string[];
  confidence?: number;
  urgency: 'critical' | 'important' | 'informational';
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  created_at: string;
  expires_at: string;
  resolved_at?: string;
  resolved_by?: string;
  resolution?: 'approve' | 'reject' | 'modify';
}

export interface EscalationAction {
  label: string;         // i18n key for button text
  callback_data: string; // callback identifier
  style?: 'primary' | 'secondary' | 'danger';
}

export interface EscalationMessage {
  escalation: Escalation;
  title_key: string;       // i18n key
  body_key: string;        // i18n key with interpolation params
  body_params: Record<string, unknown>;
  actions: EscalationAction[];
}

export type EscalationDeliveryChannel = 'telegram' | 'web' | 'email';

export type EscalationHandler = (message: EscalationMessage) => Promise<void>;

export class EscalationRouter {
  private handlers: Map<EscalationDeliveryChannel, EscalationHandler> = new Map();
  private defaultTimeout = 48 * 60 * 60 * 1000; // 48 hours
  private reminderTimeout = 24 * 60 * 60 * 1000; // 24 hours
  private pendingEscalations: Map<string, Escalation> = new Map();
  private resolvedEscalations: Map<string, Escalation> = new Map();
  private continuationHandlers: Map<string, (escalation: Escalation, modification?: Record<string, unknown>) => Promise<void>> = new Map();

  /**
   * Register a delivery channel handler (e.g., Telegram bot, web notification).
   */
  registerChannel(channel: EscalationDeliveryChannel, handler: EscalationHandler): void {
    this.handlers.set(channel, handler);
  }

  /**
   * Route an escalation to the user.
   * Primary channel: Telegram. Fallback: web dashboard notification.
   */
  async escalate(escalation: Escalation, actions: EscalationAction[]): Promise<void> {
    const message: EscalationMessage = {
      escalation,
      title_key: `escalation.${escalation.action_type}.title`,
      body_key: `escalation.${escalation.action_type}.body`,
      body_params: escalation.action_data,
      actions,
    };

    // Try Telegram first, then web
    const telegramHandler = this.handlers.get('telegram');
    if (telegramHandler) {
      await telegramHandler(message);
      return;
    }

    const webHandler = this.handlers.get('web');
    if (webHandler) {
      await webHandler(message);
      return;
    }

    console.warn(`No escalation handler available for tenant ${escalation.tenant_id}`);
  }

  /**
   * Resolve an escalation (called when user taps a button).
   */
  async resolve(
    escalationId: string,
    decision: 'approve' | 'reject' | 'modify',
    resolvedBy: string,
    modification?: Record<string, unknown>,
  ): Promise<Escalation | null> {
    const escalation = this.pendingEscalations.get(escalationId);
    if (!escalation) return null;

    escalation.status = decision === 'approve' ? 'approved' : 'rejected';
    escalation.resolved_at = new Date().toISOString();
    escalation.resolved_by = resolvedBy;
    escalation.resolution = decision;

    this.pendingEscalations.delete(escalationId);
    this.resolvedEscalations.set(escalationId, escalation);

    // Notify continuation handlers
    const handler = this.continuationHandlers.get(escalationId);
    if (handler) {
      await handler(escalation, modification);
      this.continuationHandlers.delete(escalationId);
    }

    return escalation;
  }

  /**
   * Create a pending escalation and optionally register a continuation.
   */
  async createEscalation(
    escalation: Escalation,
    actions: EscalationAction[],
    onResolution?: (escalation: Escalation, modification?: Record<string, unknown>) => Promise<void>,
  ): Promise<void> {
    this.pendingEscalations.set(escalation.id, escalation);
    if (onResolution) {
      this.continuationHandlers.set(escalation.id, onResolution);
    }
    await this.escalate(escalation, actions);
  }

  /**
   * Get a pending escalation by ID.
   */
  getPending(escalationId: string): Escalation | undefined {
    return this.pendingEscalations.get(escalationId);
  }

  /**
   * List all pending escalations for a tenant.
   */
  listPending(tenantId: string): Escalation[] {
    return Array.from(this.pendingEscalations.values())
      .filter(e => e.tenant_id === tenantId);
  }
}
