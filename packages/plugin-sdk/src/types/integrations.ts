/**
 * Integration Types
 * Standardized interfaces for 3rd-party service integrations
 * 
 * Note: StorageUploadOptions, AICompletionOptions, and EmailOptions are imported
 * from services.ts to avoid type duplication and maintain consistency.
 */

import type { StorageUploadOptions, AICompletionOptions, EmailOptions } from './services.js';

// Re-export these types for integrations to use
export type { StorageUploadOptions, AICompletionOptions, EmailOptions };

export interface HealthStatus {
  healthy: boolean;
  message?: string;
  latency?: number;
  lastCheck?: Date;
}

export interface IntegrationConfig {
  type: string;
  credentials: Record<string, string>;
  options?: Record<string, unknown>;
}

export interface Integration {
  name: string;
  type: string;
  
  /** Initialize the integration with config */
  initialize(config: IntegrationConfig): Promise<void>;
  
  /** Check if the integration is healthy */
  healthCheck(): Promise<HealthStatus>;
  
  /** Gracefully shutdown the integration */
  shutdown(): Promise<void>;
  
  /** Validate credentials */
  validateCredentials(): Promise<boolean>;
  
  /** Rotate credentials */
  rotateCredentials?(newCreds: Record<string, string>): Promise<void>;
}

// Storage Integrations (AWS S3, GCP Storage, Azure Blob)
export interface StorageIntegration extends Integration {
  upload(key: string, data: Buffer | string, options?: StorageUploadOptions): Promise<string>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  getSignedUrl(key: string, expiresIn?: number): Promise<string>;
}

// AI/ML Integrations (OpenAI, Anthropic, etc.)
export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModerationResult {
  flagged: boolean;
  categories: Record<string, boolean>;
  scores: Record<string, number>;
}

export interface AIIntegration extends Integration {
  complete(prompt: string, options?: AICompletionOptions): Promise<string>;
  chat(messages: AIMessage[], options?: AICompletionOptions): Promise<string>;
  embed(text: string | string[]): Promise<number[] | number[][]>;
  moderate(content: string): Promise<ModerationResult>;
}

// Email Integrations (SendGrid, Mailgun, SES)
export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType: string;
}

export interface EmailIntegration extends Integration {
  send(to: string | string[], subject: string, body: string, options?: EmailOptions): Promise<void>;
  sendHtml(to: string | string[], subject: string, html: string, options?: EmailOptions): Promise<void>;
  sendTemplate(
    to: string | string[],
    templateId: string,
    variables: Record<string, unknown>,
    options?: EmailOptions
  ): Promise<void>;
}

// Payment Integrations (Stripe, PayPal)
export interface PaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  clientSecret?: string;
}

export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  error?: string;
}

export interface RefundResult {
  success: boolean;
  refundId?: string;
  amount: number;
  error?: string;
}

export interface PaymentIntegration extends Integration {
  createPayment(amount: number, currency: string, metadata?: Record<string, string>): Promise<PaymentIntent>;
  processPayment(paymentId: string): Promise<PaymentResult>;
  refund(paymentId: string, amount?: number): Promise<RefundResult>;
  getPaymentStatus(paymentId: string): Promise<PaymentIntent>;
}

// Messaging Integrations (Twilio, SNS)
export interface SMSResult {
  messageId: string;
  status: 'queued' | 'sent' | 'delivered' | 'failed';
}

export interface MessagingIntegration extends Integration {
  sendSMS(to: string, message: string, from?: string): Promise<SMSResult>;
  sendWhatsApp(to: string, message: string): Promise<SMSResult>;
}

// Integration Metadata for Registry
export interface IntegrationMetadata {
  type: string;
  name: string;
  description: string;
  icon: string;
  category: 'storage' | 'ai' | 'email' | 'payment' | 'messaging' | 'other';
  configSchema: {
    fields: Record<string, {
      type: 'string' | 'number' | 'boolean';
      label: string;
      required: boolean;
      secret?: boolean;
      placeholder?: string;
    }>;
  };
}
