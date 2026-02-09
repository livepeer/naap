/**
 * Mock Factories for Plugin Testing
 *
 * Factory functions to create mock objects for testing plugins.
 * These provide sensible defaults that can be overridden as needed.
 *
 * @example
 * ```typescript
 * import { createMockUser, createMockTeam, createMockConfig } from '@naap/plugin-sdk/testing';
 *
 * const user = createMockUser({ displayName: 'John Doe' });
 * const team = createMockTeam({ name: 'Test Team' });
 * const config = createMockConfig({ theme: 'dark' });
 * ```
 */

import type { AuthUser } from '../types/services.js';

// ============================================
// User Factory
// ============================================

/**
 * Options for creating a mock user
 */
export interface CreateMockUserOptions {
  id?: string;
  email?: string | null;
  displayName?: string | null;
  avatar?: string | null;
  avatarUrl?: string | null;
  address?: string | null;
  walletAddress?: string | null;
  roles?: string[];
  permissions?: Array<{ resource: string; action: string }> | string[];
}

/**
 * Create a mock authenticated user
 *
 * @param overrides - Optional overrides for the user properties
 * @returns A mock AuthUser object
 *
 * @example
 * ```typescript
 * // Default user
 * const user = createMockUser();
 *
 * // Admin user
 * const admin = createMockUser({
 *   displayName: 'Admin User',
 *   roles: ['admin', 'user'],
 *   permissions: [{ resource: '*', action: '*' }],
 * });
 *
 * // User with wallet
 * const walletUser = createMockUser({
 *   walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
 * });
 * ```
 */
export function createMockUser(overrides?: CreateMockUserOptions): AuthUser {
  return {
    id: overrides?.id ?? 'mock-user-id',
    email: overrides?.email ?? 'test@example.com',
    displayName: overrides?.displayName ?? 'Test User',
    avatar: overrides?.avatar ?? null,
    avatarUrl: overrides?.avatarUrl ?? 'https://example.com/avatar.png',
    address: overrides?.address ?? null,
    walletAddress: overrides?.walletAddress ?? null,
    roles: overrides?.roles ?? ['user'],
    permissions: overrides?.permissions ?? [],
  };
}

// ============================================
// Team Factory
// ============================================

/**
 * Team member role
 */
export type TeamRole = 'owner' | 'admin' | 'member' | 'viewer';

/**
 * Mock team member
 */
export interface MockTeamMember {
  id: string;
  userId: string;
  teamId: string;
  role: TeamRole;
  user?: AuthUser;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Mock team
 */
export interface MockTeam {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  avatarUrl?: string | null;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Options for creating a mock team
 */
export interface CreateMockTeamOptions {
  id?: string;
  name?: string;
  slug?: string;
  description?: string | null;
  avatarUrl?: string | null;
  ownerId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Options for creating a mock team member
 */
export interface CreateMockTeamMemberOptions {
  id?: string;
  userId?: string;
  teamId?: string;
  role?: TeamRole;
  user?: AuthUser;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Create a mock team
 *
 * @param overrides - Optional overrides for the team properties
 * @returns A mock Team object
 *
 * @example
 * ```typescript
 * // Default team
 * const team = createMockTeam();
 *
 * // Custom team
 * const customTeam = createMockTeam({
 *   name: 'Engineering Team',
 *   slug: 'engineering',
 *   description: 'The engineering team',
 * });
 * ```
 */
export function createMockTeam(overrides?: CreateMockTeamOptions): MockTeam {
  const now = new Date();
  return {
    id: overrides?.id ?? 'mock-team-id',
    name: overrides?.name ?? 'Test Team',
    slug: overrides?.slug ?? 'test-team',
    description: overrides?.description ?? 'A test team for testing',
    avatarUrl: overrides?.avatarUrl ?? null,
    ownerId: overrides?.ownerId ?? 'mock-user-id',
    createdAt: overrides?.createdAt ?? now,
    updatedAt: overrides?.updatedAt ?? now,
  };
}

/**
 * Create a mock team member
 *
 * @param overrides - Optional overrides for the member properties
 * @returns A mock TeamMember object
 *
 * @example
 * ```typescript
 * // Default member
 * const member = createMockTeamMember();
 *
 * // Admin member
 * const admin = createMockTeamMember({ role: 'admin' });
 *
 * // Member with user data
 * const memberWithUser = createMockTeamMember({
 *   user: createMockUser({ displayName: 'John' }),
 * });
 * ```
 */
export function createMockTeamMember(overrides?: CreateMockTeamMemberOptions): MockTeamMember {
  const now = new Date();
  return {
    id: overrides?.id ?? 'mock-member-id',
    userId: overrides?.userId ?? 'mock-user-id',
    teamId: overrides?.teamId ?? 'mock-team-id',
    role: overrides?.role ?? 'member',
    user: overrides?.user,
    createdAt: overrides?.createdAt ?? now,
    updatedAt: overrides?.updatedAt ?? now,
  };
}

// ============================================
// Plugin Factory
// ============================================

/**
 * Mock plugin manifest
 */
export interface MockPlugin {
  id: string;
  name: string;
  displayName: string;
  version: string;
  description?: string;
  category: string;
  author?: string;
  icon?: string;
  enabled: boolean;
  installed: boolean;
  installedAt?: Date;
  updatedAt?: Date;
}

/**
 * Options for creating a mock plugin
 */
export interface CreateMockPluginOptions {
  id?: string;
  name?: string;
  displayName?: string;
  version?: string;
  description?: string;
  category?: string;
  author?: string;
  icon?: string;
  enabled?: boolean;
  installed?: boolean;
  installedAt?: Date;
  updatedAt?: Date;
}

/**
 * Create a mock plugin
 *
 * @param overrides - Optional overrides for the plugin properties
 * @returns A mock Plugin object
 *
 * @example
 * ```typescript
 * // Default plugin
 * const plugin = createMockPlugin();
 *
 * // Custom plugin
 * const customPlugin = createMockPlugin({
 *   name: 'my-wallet',
 *   displayName: 'My Wallet',
 *   category: 'finance',
 * });
 *
 * // Disabled plugin
 * const disabled = createMockPlugin({ enabled: false });
 * ```
 */
export function createMockPlugin(overrides?: CreateMockPluginOptions): MockPlugin {
  const now = new Date();
  return {
    id: overrides?.id ?? 'mock-plugin-id',
    name: overrides?.name ?? 'test-plugin',
    displayName: overrides?.displayName ?? 'Test Plugin',
    version: overrides?.version ?? '1.0.0',
    description: overrides?.description ?? 'A test plugin for testing',
    category: overrides?.category ?? 'productivity',
    author: overrides?.author ?? 'Test Author',
    icon: overrides?.icon ?? 'Box',
    enabled: overrides?.enabled ?? true,
    installed: overrides?.installed ?? true,
    installedAt: overrides?.installedAt ?? now,
    updatedAt: overrides?.updatedAt ?? now,
  };
}

// ============================================
// Config Factory
// ============================================

/**
 * Mock plugin configuration
 */
export interface MockConfig<T = Record<string, unknown>> {
  data: T;
  scope: 'personal' | 'team' | 'tenant' | 'global';
  version?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Options for creating a mock config
 */
export interface CreateMockConfigOptions<T = Record<string, unknown>> {
  data?: T;
  scope?: 'personal' | 'team' | 'tenant' | 'global';
  version?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * Create a mock plugin configuration
 *
 * @param overrides - Optional overrides for the config properties
 * @returns A mock Config object
 *
 * @example
 * ```typescript
 * // Default config
 * const config = createMockConfig();
 *
 * // Custom config with typed data
 * interface MyConfig {
 *   theme: 'light' | 'dark';
 *   apiKey: string;
 * }
 * const typedConfig = createMockConfig<MyConfig>({
 *   data: { theme: 'dark', apiKey: 'abc123' },
 * });
 *
 * // Team-scoped config
 * const teamConfig = createMockConfig({
 *   scope: 'team',
 *   data: { sharedSetting: true },
 * });
 * ```
 */
export function createMockConfig<T = Record<string, unknown>>(
  overrides?: CreateMockConfigOptions<T>
): MockConfig<T> {
  const now = new Date();
  return {
    data: (overrides?.data ?? {}) as T,
    scope: overrides?.scope ?? 'personal',
    version: overrides?.version ?? 1,
    createdAt: overrides?.createdAt ?? now,
    updatedAt: overrides?.updatedAt ?? now,
  };
}

// ============================================
// Tenant Factory
// ============================================

/**
 * Mock tenant installation
 */
export interface MockTenantInstallation {
  id: string;
  userId: string;
  pluginId: string;
  pluginName: string;
  enabled: boolean;
  config: Record<string, unknown>;
  installedAt: Date;
  updatedAt: Date;
}

/**
 * Options for creating a mock tenant installation
 */
export interface CreateMockTenantInstallationOptions {
  id?: string;
  userId?: string;
  pluginId?: string;
  pluginName?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
  installedAt?: Date;
  updatedAt?: Date;
}

/**
 * Create a mock tenant installation
 *
 * @param overrides - Optional overrides for the installation properties
 * @returns A mock TenantInstallation object
 *
 * @example
 * ```typescript
 * const installation = createMockTenantInstallation({
 *   pluginName: 'my-wallet',
 *   config: { currency: 'USD' },
 * });
 * ```
 */
export function createMockTenantInstallation(
  overrides?: CreateMockTenantInstallationOptions
): MockTenantInstallation {
  const now = new Date();
  return {
    id: overrides?.id ?? 'mock-installation-id',
    userId: overrides?.userId ?? 'mock-user-id',
    pluginId: overrides?.pluginId ?? 'mock-plugin-id',
    pluginName: overrides?.pluginName ?? 'test-plugin',
    enabled: overrides?.enabled ?? true,
    config: overrides?.config ?? {},
    installedAt: overrides?.installedAt ?? now,
    updatedAt: overrides?.updatedAt ?? now,
  };
}

// ============================================
// API Response Factory
// ============================================

/**
 * Mock API response
 */
export interface MockApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

/**
 * Create a successful mock API response
 *
 * @param data - The response data
 * @returns A mock successful API response
 *
 * @example
 * ```typescript
 * const response = createMockApiSuccess({ items: [] });
 * // { success: true, data: { items: [] } }
 * ```
 */
export function createMockApiSuccess<T>(data: T): MockApiResponse<T> {
  return {
    success: true,
    data,
  };
}

/**
 * Create a failed mock API response
 *
 * @param error - The error message
 * @returns A mock failed API response
 *
 * @example
 * ```typescript
 * const response = createMockApiError('Not found');
 * // { success: false, error: 'Not found' }
 * ```
 */
export function createMockApiError(error: string): MockApiResponse<never> {
  return {
    success: false,
    error,
  };
}

// ============================================
// Query State Factory
// ============================================

/**
 * Mock query state (for useQuery)
 */
export interface MockQueryState<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
  isSuccess: boolean;
  isStale: boolean;
}

/**
 * Create a loading query state
 */
export function createMockQueryLoading<T>(): MockQueryState<T> {
  return {
    data: undefined,
    loading: true,
    error: null,
    isSuccess: false,
    isStale: false,
  };
}

/**
 * Create a successful query state
 *
 * @param data - The query data
 * @param isStale - Whether the data is stale
 */
export function createMockQuerySuccess<T>(data: T, isStale = false): MockQueryState<T> {
  return {
    data,
    loading: false,
    error: null,
    isSuccess: true,
    isStale,
  };
}

/**
 * Create an error query state
 *
 * @param error - The error
 */
export function createMockQueryError<T>(error: Error | string): MockQueryState<T> {
  return {
    data: undefined,
    loading: false,
    error: typeof error === 'string' ? new Error(error) : error,
    isSuccess: false,
    isStale: false,
  };
}
