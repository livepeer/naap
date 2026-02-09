/**
 * Service registry types and interfaces
 */

export type ServiceType = 'kafka' | 'rest' | 'websocket' | 'custom';

export interface Service {
  name: string;
  type: ServiceType;
  start(): Promise<void>;
  stop(): Promise<void>;
  health(): Promise<boolean>;
  metadata?: Record<string, any>;
}

export interface ServiceConfig {
  name: string;
  type: ServiceType;
  enabled: boolean;
  config: Record<string, any>;
}

export interface ServiceHealth {
  name: string;
  type: ServiceType;
  status: 'healthy' | 'unhealthy' | 'starting' | 'stopping';
  lastCheck?: Date;
  error?: string;
}
