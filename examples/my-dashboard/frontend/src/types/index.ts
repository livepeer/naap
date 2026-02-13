/**
 * Type definitions for My Dashboard plugin
 */

export interface Dashboard {
  id: string;
  metabaseId: number;
  name: string;
  description?: string;
  thumbnail?: string;
  isDefault: boolean;
  order: number;
  createdBy: string;
  createdAt: string;
}

export interface UserPreference {
  id: string;
  userId: string;
  dashboardId: string;
  pinned: boolean;
  order: number;
}

export interface PluginConfig {
  metabaseUrl: string;
  metabaseSecretKey: string;
  tokenExpiry: number;
  enableInteractive: boolean;
}

export interface EmbedResponse {
  embedUrl: string;
  expiresAt: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  meta?: {
    page?: number;
    total?: number;
  };
}
