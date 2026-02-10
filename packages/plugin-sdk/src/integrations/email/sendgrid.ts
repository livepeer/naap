/**
 * SendGrid Integration
 * Email delivery using SendGrid
 */

import type { 
  EmailIntegration, 
  IntegrationConfig, 
  HealthStatus,
  EmailOptions,
} from '../../types/integrations.js';

export class SendGridIntegration implements EmailIntegration {
  name = 'sendgrid';
  type = 'sendgrid';
  
  private apiKey: string = '';
  private fromEmail?: string;
  private baseUrl = 'https://api.sendgrid.com/v3';

  async initialize(config: IntegrationConfig): Promise<void> {
    this.apiKey = config.credentials.apiKey;
    this.fromEmail = config.credentials.fromEmail;
    
    if (!this.apiKey) {
      throw new Error('SendGrid API key is required');
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    try {
      const startTime = Date.now();
      const response = await this.request('GET', '/user/credits');
      
      return {
        healthy: response.ok,
        message: response.ok ? 'Connected' : `HTTP ${response.status}`,
        latency: Date.now() - startTime,
        lastCheck: new Date(),
      };
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        lastCheck: new Date(),
      };
    }
  }

  async shutdown(): Promise<void> {
    // No cleanup needed
  }

  async validateCredentials(): Promise<boolean> {
    const health = await this.healthCheck();
    return health.healthy;
  }

  async send(
    to: string | string[], 
    subject: string, 
    body: string, 
    options?: EmailOptions
  ): Promise<void> {
    await this.sendMail({
      to,
      subject,
      content: [{ type: 'text/plain', value: body }],
      ...this.convertOptions(options),
    });
  }

  async sendHtml(
    to: string | string[], 
    subject: string, 
    html: string, 
    options?: EmailOptions
  ): Promise<void> {
    await this.sendMail({
      to,
      subject,
      content: [{ type: 'text/html', value: html }],
      ...this.convertOptions(options),
    });
  }

  /**
   * Convert EmailOptions (with EmailRecipient objects) to plain string fields
   * for sendMail. Also extracts attachments so they aren't silently dropped.
   */
  private convertOptions(options?: EmailOptions): {
    from?: string;
    replyTo?: string;
    cc?: string[];
    bcc?: string[];
    attachments?: Array<{ filename: string; content: string | Buffer; contentType?: string }>;
  } {
    if (!options) return {};
    const toEmail = (r?: { email: string }) => r?.email;
    return {
      ...(options.from ? { from: toEmail(options.from) } : {}),
      ...(options.replyTo ? { replyTo: toEmail(options.replyTo) } : {}),
      ...(options.cc ? { cc: options.cc.map(r => r.email) } : {}),
      ...(options.bcc ? { bcc: options.bcc.map(r => r.email) } : {}),
      ...(options.attachments ? { attachments: options.attachments } : {}),
    };
  }

  /** Extract email string from an EmailRecipient or plain string */
  private resolveEmail(recipient: string | { email: string; name?: string } | undefined, fallback: string): string {
    if (!recipient) return fallback;
    if (typeof recipient === 'string') return recipient;
    return recipient.email;
  }

  async sendTemplate(
    to: string | string[],
    templateId: string,
    variables: Record<string, unknown>,
    options?: EmailOptions
  ): Promise<void> {
    const toArray = Array.isArray(to) ? to : [to];
    const fromEmail = this.resolveEmail(options?.from, this.fromEmail || 'noreply@example.com');
    const replyToEmail = options?.replyTo ? this.resolveEmail(options.replyTo, '') : undefined;

    const response = await this.request('POST', '/mail/send', {
      personalizations: [{
        to: toArray.map(email => ({ email })),
        dynamic_template_data: variables,
      }],
      from: { email: fromEmail },
      template_id: templateId,
      reply_to: replyToEmail ? { email: replyToEmail } : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.errors?.[0]?.message || `SendGrid error: ${response.status}`);
    }
  }

  private async sendMail(params: {
    to: string | string[];
    subject: string;
    content: Array<{ type: string; value: string }>;
    from?: string;
    replyTo?: string;
    cc?: string[];
    bcc?: string[];
    attachments?: Array<{ filename: string; content: string | Buffer; contentType?: string }>;
  }): Promise<void> {
    const toArray = Array.isArray(params.to) ? params.to : [params.to];

    // Build the SendGrid payload
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: Record<string, any> = {
      personalizations: [{
        to: toArray.map(email => ({ email })),
        cc: params.cc?.map(email => ({ email })),
        bcc: params.bcc?.map(email => ({ email })),
      }],
      from: { email: params.from || this.fromEmail || 'noreply@example.com' },
      reply_to: params.replyTo ? { email: params.replyTo } : undefined,
      subject: params.subject,
      content: params.content,
    };

    // Include attachments if provided (base64-encoded for SendGrid)
    if (params.attachments && params.attachments.length > 0) {
      payload.attachments = params.attachments.map((a) => ({
        filename: a.filename,
        content: typeof a.content === 'string' ? a.content : a.content.toString('base64'),
        type: a.contentType,
      }));
    }

    const response = await this.request('POST', '/mail/send', payload);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.errors?.[0]?.message || `SendGrid error: ${response.status}`);
    }
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
}

export function createSendGridIntegration(config: IntegrationConfig): SendGridIntegration {
  const integration = new SendGridIntegration();
  integration.initialize(config);
  return integration;
}
