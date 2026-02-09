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
      ...options,
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
      ...options,
    });
  }

  async sendTemplate(
    to: string | string[],
    templateId: string,
    variables: Record<string, unknown>,
    options?: EmailOptions
  ): Promise<void> {
    const toArray = Array.isArray(to) ? to : [to];
    
    const response = await this.request('POST', '/mail/send', {
      personalizations: [{
        to: toArray.map(email => ({ email })),
        dynamic_template_data: variables,
      }],
      from: { email: options?.from || this.fromEmail || 'noreply@example.com' },
      template_id: templateId,
      reply_to: options?.replyTo ? { email: options.replyTo } : undefined,
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
  }): Promise<void> {
    const toArray = Array.isArray(params.to) ? params.to : [params.to];
    
    const response = await this.request('POST', '/mail/send', {
      personalizations: [{
        to: toArray.map(email => ({ email })),
        cc: params.cc?.map(email => ({ email })),
        bcc: params.bcc?.map(email => ({ email })),
      }],
      from: { email: params.from || this.fromEmail || 'noreply@example.com' },
      reply_to: params.replyTo ? { email: params.replyTo } : undefined,
      subject: params.subject,
      content: params.content,
    });

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
