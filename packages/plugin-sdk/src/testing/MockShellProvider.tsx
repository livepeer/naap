/**
 * Mock Shell Provider for Testing
 *
 * Provides a mock ShellContext for testing plugins without a real shell.
 * Phase 7: Extended with mocks for usePluginConfig, useTeam, useQuery, useTenant
 */

import React, { type ReactNode, createContext, useContext, useState, useCallback } from 'react';
import { ShellProvider } from '../hooks/useShell.js';
import type { ShellContext, ITeamContext, ITenantService, ITenantContext } from '../types/services.js';
import {
  createMockUser,
  createMockTeam,
  createMockTeamMember,
  createMockTenantInstallation,
  type MockTeam,
  type MockTeamMember,
  type MockTenantInstallation,
} from './mockFactories.js';

/**
 * Create a mock notification service
 */
function createMockNotificationService() {
  return {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
    dismiss: jest.fn(),
    dismissAll: jest.fn(),
  };
}

/**
 * Create a mock auth service
 */
function createMockAuthService(overrides?: Partial<ShellContext['auth']>) {
  return {
    getUser: jest.fn().mockReturnValue({
      id: 'test-user-id',
      walletAddress: '0x1234567890abcdef',
      displayName: 'Test User',
      roles: ['user'],
      permissions: [],
    }),
    getToken: jest.fn().mockResolvedValue('mock-token'),
    hasRole: jest.fn().mockReturnValue(false),
    hasPermission: jest.fn().mockReturnValue(false),
    isAuthenticated: jest.fn().mockReturnValue(true),
    onAuthStateChange: jest.fn().mockReturnValue(() => {}),
    ...overrides,
  };
}

/**
 * Create a mock event bus with request/response support (Phase 7)
 */
function createMockEventBus() {
  const handlers = new Map<string, Set<Function>>();
  const requestHandlers = new Map<string, Function>();

  return {
    emit: jest.fn((event: string, data?: unknown) => {
      const eventHandlers = handlers.get(event);
      if (eventHandlers) {
        eventHandlers.forEach((handler) => handler(data));
      }
    }),
    on: jest.fn((event: string, callback: Function) => {
      if (!handlers.has(event)) {
        handlers.set(event, new Set());
      }
      handlers.get(event)!.add(callback);
      return () => handlers.get(event)?.delete(callback);
    }),
    off: jest.fn((event: string, callback: Function) => {
      handlers.get(event)?.delete(callback);
    }),
    once: jest.fn((event: string, callback: Function) => {
      const wrapper = (data: unknown) => {
        callback(data);
        handlers.get(event)?.delete(wrapper);
      };
      if (!handlers.has(event)) {
        handlers.set(event, new Set());
      }
      handlers.get(event)!.add(wrapper);
      return () => handlers.get(event)?.delete(wrapper);
    }),
    // Phase 7: Request/Response pattern support
    request: jest.fn(async <TReq, TRes>(event: string, data?: TReq): Promise<TRes> => {
      const handler = requestHandlers.get(event);
      if (!handler) {
        throw new Error(`No handler registered for event: ${event}`);
      }
      return handler(data) as TRes;
    }),
    handleRequest: jest.fn(<TReq, TRes>(event: string, handler: (data: TReq) => TRes | Promise<TRes>) => {
      requestHandlers.set(event, handler as Function);
      return () => requestHandlers.delete(event);
    }),
  };
}

/**
 * Create a mock theme service
 */
function createMockThemeService() {
  return {
    mode: 'dark' as const,
    colors: {
      primary: '#10b981',
      secondary: '#6366f1',
      accent: '#10b981',
      background: '#0a0a0f',
      text: '#ffffff',
      error: '#ef4444',
      warning: '#f59e0b',
      success: '#10b981',
      info: '#3b82f6',
    },
    toggle: jest.fn(),
    setMode: jest.fn(),
    onChange: jest.fn().mockReturnValue(() => {}),
  };
}

/**
 * Create a mock logger service
 */
function createMockLoggerService() {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };
  return logger;
}

/**
 * Create a mock permission service
 */
function createMockPermissionService() {
  return {
    can: jest.fn().mockReturnValue(true),
    getPermissions: jest.fn().mockReturnValue([]),
    require: jest.fn(),
  };
}

/**
 * Create a mock integration service
 */
function createMockIntegrationService() {
  return {
    ai: {
      complete: jest.fn().mockResolvedValue({ content: 'Mock AI response' }),
      chat: jest.fn().mockResolvedValue({ content: 'Mock chat response' }),
      embed: jest.fn().mockResolvedValue([[]]),
      isConfigured: jest.fn().mockReturnValue(true),
      getModels: jest.fn().mockResolvedValue(['gpt-4']),
    },
    storage: {
      upload: jest.fn().mockResolvedValue({ key: 'test', url: 'http://test', size: 0 }),
      download: jest.fn().mockResolvedValue(new Blob()),
      getSignedUrl: jest.fn().mockResolvedValue('http://signed-url'),
      delete: jest.fn().mockResolvedValue(undefined),
      list: jest.fn().mockResolvedValue([]),
      isConfigured: jest.fn().mockReturnValue(true),
    },
    email: {
      send: jest.fn().mockResolvedValue({ messageId: 'mock-id' }),
      sendTemplate: jest.fn().mockResolvedValue({ messageId: 'mock-id' }),
      isConfigured: jest.fn().mockReturnValue(true),
    },
    isConfigured: jest.fn().mockReturnValue(true),
    getAvailable: jest.fn().mockReturnValue([
      { type: 'ai', configured: true },
      { type: 'storage', configured: true },
      { type: 'email', configured: true },
    ]),
  };
}

// ============================================
// Phase 7: Team Context Mock
// ============================================

/**
 * Options for mock team context
 */
export interface MockTeamContextOptions {
  currentTeam?: MockTeam | null;
  currentMember?: MockTeamMember | null;
  hasTeamPermission?: (permission: string) => boolean;
}

/**
 * Create a mock team context service
 */
function createMockTeamContext(options?: MockTeamContextOptions): ITeamContext {
  const team = options?.currentTeam ?? createMockTeam();
  const member = options?.currentMember ?? createMockTeamMember();

  return {
    currentTeam: team,
    currentMember: member,
    isTeamContext: team !== null,
    memberRole: member?.role ?? null,
    setCurrentTeam: jest.fn(),
    hasTeamPermission: options?.hasTeamPermission ?? jest.fn().mockReturnValue(true),
    refreshTeam: jest.fn().mockResolvedValue(undefined),
  } as unknown as ITeamContext;
}

// ============================================
// Phase 7: Tenant Service Mock
// ============================================

/**
 * Options for mock tenant service
 */
export interface MockTenantServiceOptions {
  installations?: MockTenantInstallation[];
  currentInstallation?: MockTenantInstallation | null;
}

/**
 * Create a mock tenant service
 */
function createMockTenantService(options?: MockTenantServiceOptions): ITenantService {
  const installations = options?.installations ?? [createMockTenantInstallation()];

  return {
    getInstallations: jest.fn().mockResolvedValue(installations),
    getInstallationByPlugin: jest.fn().mockImplementation((pluginName: string) => {
      const found = installations.find((i) => i.pluginName === pluginName);
      return Promise.resolve(found || null);
    }),
    installPlugin: jest.fn().mockResolvedValue(createMockTenantInstallation()),
    uninstallPlugin: jest.fn().mockResolvedValue(undefined),
    enablePlugin: jest.fn().mockResolvedValue(undefined),
    disablePlugin: jest.fn().mockResolvedValue(undefined),
    getConfig: jest.fn().mockResolvedValue({}),
    updateConfig: jest.fn().mockResolvedValue({}),
    getPreferences: jest.fn().mockResolvedValue({}),
    updatePreferences: jest.fn().mockResolvedValue({}),
  };
}

/**
 * Create a mock tenant context
 */
function createMockTenantContext(options?: MockTenantServiceOptions): ITenantContext {
  return {
    currentInstallation: options?.currentInstallation ?? null,
    isTenantContext: options?.currentInstallation !== null,
    setCurrentPlugin: jest.fn().mockResolvedValue(undefined),
    refreshInstallation: jest.fn().mockResolvedValue(undefined),
    isLoading: false,
  };
}

// ============================================
// Phase 7: Plugin Config Mock Context
// ============================================

/**
 * Mock plugin config state
 */
export interface MockPluginConfigState<T = Record<string, unknown>> {
  config: T;
  sharedConfig?: T;
  personalConfig?: Partial<T>;
  loading: boolean;
  error: Error | null;
}

/**
 * Context for mocking usePluginConfig hook
 */
export const MockPluginConfigContext = createContext<{
  state: MockPluginConfigState;
  updateConfig: (updates: Partial<unknown>) => Promise<void>;
  updateSharedConfig?: (updates: Partial<unknown>) => Promise<void>;
  resetConfig: () => Promise<void>;
  refresh: () => Promise<void>;
} | null>(null);

/**
 * Hook to use mock plugin config in tests
 */
export function useMockPluginConfig<T = Record<string, unknown>>() {
  const context = useContext(MockPluginConfigContext);
  if (!context) {
    // Return default mock if not in provider
    return {
      config: {} as T,
      loading: false,
      error: null,
      updateConfig: jest.fn().mockResolvedValue(undefined),
      resetConfig: jest.fn().mockResolvedValue(undefined),
      refresh: jest.fn().mockResolvedValue(undefined),
    };
  }
  return context as unknown as {
    config: T;
    sharedConfig?: T;
    personalConfig?: Partial<T>;
    loading: boolean;
    error: Error | null;
    updateConfig: (updates: Partial<T>) => Promise<void>;
    updateSharedConfig?: (updates: Partial<T>) => Promise<void>;
    resetConfig: () => Promise<void>;
    refresh: () => Promise<void>;
  };
}

// ============================================
// Phase 7: Query Mock Context
// ============================================

/**
 * Mock query state for useQuery/useMutation
 */
export interface MockQueryState<T = unknown> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
  isSuccess: boolean;
  isStale: boolean;
}

/**
 * Context for mocking useQuery hook
 */
export const MockQueryContext = createContext<Map<string, MockQueryState> | null>(null);

/**
 * Hook to use mock query in tests
 */
export function useMockQuery<T>(key: string): MockQueryState<T> & { refetch: () => Promise<void> } {
  const context = useContext(MockQueryContext);
  const state = context?.get(key) as MockQueryState<T> | undefined;

  return {
    data: state?.data as T | undefined,
    loading: state?.loading ?? false,
    error: state?.error ?? null,
    isSuccess: state?.isSuccess ?? false,
    isStale: state?.isStale ?? false,
    refetch: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * Create a complete mock shell context
 */
export function createMockShellContext(
  overrides?: Partial<ShellContext> & {
    teamContext?: MockTeamContextOptions;
    tenantService?: MockTenantServiceOptions;
  }
): ShellContext {
  return {
    auth: createMockAuthService(overrides?.auth),
    navigate: jest.fn(),
    eventBus: createMockEventBus(),
    theme: createMockThemeService(),
    notifications: createMockNotificationService(),
    integrations: createMockIntegrationService(),
    logger: createMockLoggerService(),
    permissions: createMockPermissionService(),
    // Phase 7: Team context
    team: createMockTeamContext(overrides?.teamContext) as unknown as ShellContext['team'],
    // Phase 7: Tenant service
    tenant: createMockTenantService(overrides?.tenantService),
    // Phase 7: Tenant context
    tenantContext: createMockTenantContext(overrides?.tenantService),
    version: '1.0.0-test',
    ...overrides,
  } as ShellContext;
}

/**
 * createTestShellContext (Phase 6c)
 * Alias for createMockShellContext for compatibility with roadmap naming.
 */
export function createTestShellContext(
  overrides?: Partial<ShellContext>
): ShellContext {
  return createMockShellContext(overrides);
}

/**
 * Props for MockShellProvider
 */
export interface MockShellProviderProps {
  children: ReactNode;
  /** Partial overrides for the mock context */
  context?: Partial<ShellContext> & {
    teamContext?: MockTeamContextOptions;
    tenantService?: MockTenantServiceOptions;
  };
  /** Mock plugin config state */
  pluginConfig?: MockPluginConfigState;
  /** Mock query states (key -> state) */
  queryStates?: Map<string, MockQueryState>;
}

/**
 * Mock shell provider for testing plugins.
 *
 * Wraps children with a ShellProvider containing mock services.
 * All services use jest.fn() for easy mocking and assertions.
 *
 * Phase 7: Extended with support for:
 * - Team context (useTeam)
 * - Tenant service (useTenant)
 * - Plugin config (usePluginConfig)
 * - Query states (useQuery)
 *
 * @example
 * ```tsx
 * import { render, screen } from '@testing-library/react';
 * import { MockShellProvider, createMockUser, createMockTeam } from '@naap/plugin-sdk/testing';
 * import { MyPluginComponent } from './MyPluginComponent';
 *
 * describe('MyPluginComponent', () => {
 *   it('renders correctly', () => {
 *     render(
 *       <MockShellProvider>
 *         <MyPluginComponent />
 *       </MockShellProvider>
 *     );
 *     expect(screen.getByText('Hello')).toBeInTheDocument();
 *   });
 *
 *   it('shows team name', () => {
 *     render(
 *       <MockShellProvider
 *         context={{
 *           teamContext: {
 *             currentTeam: createMockTeam({ name: 'Engineering' }),
 *           },
 *         }}
 *       >
 *         <MyPluginComponent />
 *       </MockShellProvider>
 *     );
 *     expect(screen.getByText('Engineering')).toBeInTheDocument();
 *   });
 *
 *   it('uses plugin config', () => {
 *     render(
 *       <MockShellProvider
 *         pluginConfig={{
 *           config: { theme: 'dark', apiKey: 'test-key' },
 *           loading: false,
 *           error: null,
 *         }}
 *       >
 *         <MyPluginComponent />
 *       </MockShellProvider>
 *     );
 *     expect(screen.getByText('dark')).toBeInTheDocument();
 *   });
 * });
 * ```
 */
export function MockShellProvider({
  children,
  context,
  pluginConfig,
  queryStates,
}: MockShellProviderProps) {
  const mockContext = createMockShellContext(context);

  // Create plugin config context value
  const configValue = pluginConfig
    ? {
        state: pluginConfig,
        updateConfig: jest.fn().mockResolvedValue(undefined),
        updateSharedConfig: jest.fn().mockResolvedValue(undefined),
        resetConfig: jest.fn().mockResolvedValue(undefined),
        refresh: jest.fn().mockResolvedValue(undefined),
      }
    : null;

  let content = (
    <ShellProvider value={mockContext}>
      {children}
    </ShellProvider>
  );

  // Wrap with plugin config context if provided
  if (configValue) {
    content = (
      <MockPluginConfigContext.Provider value={configValue}>
        {content}
      </MockPluginConfigContext.Provider>
    );
  }

  // Wrap with query context if provided
  if (queryStates) {
    content = (
      <MockQueryContext.Provider value={queryStates}>
        {content}
      </MockQueryContext.Provider>
    );
  }

  return content;
}

export default MockShellProvider;

// ============================================
// Phase 6c: renderWithShell() Test Wrapper
// ============================================

/**
 * Options for renderWithShell
 */
export interface RenderWithShellOptions {
  /** Partial overrides for the mock shell context */
  context?: Partial<ShellContext>;
  /** React Router initial path (wraps with MemoryRouter if provided) */
  initialPath?: string;
}

/**
 * Render a plugin component wrapped in MockShellProvider.
 * 
 * Compatible with @testing-library/react's render function.
 * Returns the render result plus the mock shell context for assertions.
 * 
 * @example
 * ```tsx
 * import { renderWithShell } from '@naap/plugin-sdk/testing';
 * import { screen } from '@testing-library/react';
 * import { MyComponent } from './MyComponent';
 * 
 * const { shellContext } = renderWithShell(<MyComponent />, {
 *   context: { auth: { isAuthenticated: () => true } },
 * });
 * 
 * expect(screen.getByText('Hello')).toBeInTheDocument();
 * expect(shellContext.auth.isAuthenticated).toHaveBeenCalled();
 * ```
 */
export function renderWithShell(
  ui: React.ReactElement,
  options: RenderWithShellOptions = {}
) {
  const shellContext = createMockShellContext(options.context);

  // Try to import @testing-library/react dynamically at test time
  // This avoids requiring it as a production dependency
  let render: (ui: React.ReactElement, options?: unknown) => unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rtl = require('@testing-library/react');
    render = rtl.render;
  } catch {
    throw new Error(
      'renderWithShell requires @testing-library/react. Install it as a devDependency.'
    );
  }

  const wrapper = ({ children }: { children: ReactNode }) => {
    let content: React.ReactElement = React.createElement(
      ShellProvider,
      { value: shellContext },
      children
    );

    // Wrap with MemoryRouter if initialPath provided
    if (options.initialPath) {
      try {
        const rr = require('react-router-dom');
        content = React.createElement(
          rr.MemoryRouter,
          { initialEntries: [options.initialPath] },
          content
        );
      } catch {
        // react-router-dom not available, skip wrapping
      }
    }

    return content;
  };

  const result = render(ui, { wrapper });

  return {
    ...result,
    shellContext,
    /** Re-render with updated context */
    rerender: (newUi: React.ReactElement) => {
      return (result as { rerender: (ui: React.ReactElement) => void }).rerender(newUi);
    },
  };
}

// ============================================
// Phase 6c: createTestServer() Mock Backend
// ============================================

interface MockRoute {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  handler: (req: MockRequest) => MockResponse | Promise<MockResponse>;
}

interface MockRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  params: Record<string, string>;
  query: Record<string, string>;
}

interface MockResponse {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

interface MockServer {
  /** Add a GET route */
  get: (path: string, handler: MockRoute['handler']) => MockServer;
  /** Add a POST route */
  post: (path: string, handler: MockRoute['handler']) => MockServer;
  /** Add a PUT route */
  put: (path: string, handler: MockRoute['handler']) => MockServer;
  /** Add a DELETE route */
  delete: (path: string, handler: MockRoute['handler']) => MockServer;
  /** Add a PATCH route */
  patch: (path: string, handler: MockRoute['handler']) => MockServer;
  /** Handle a request (returns a mock Response) */
  handle: (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<MockResponse>;
  /** Get all registered routes */
  routes: () => MockRoute[];
  /** Create a mock IApiClient that routes requests to this server */
  createApiClient: () => {
    get: <T>(url: string) => Promise<T>;
    post: <T>(url: string, body?: unknown) => Promise<T>;
    put: <T>(url: string, body?: unknown) => Promise<T>;
    delete: <T>(url: string) => Promise<T>;
    patch: <T>(url: string, body?: unknown) => Promise<T>;
  };
  /** Reset all routes and call history */
  reset: () => void;
  /** Get call history */
  calls: () => Array<{ method: string; path: string; body?: unknown }>;
}

/**
 * Create a mock server for testing plugin backends.
 * 
 * Allows defining mock routes that can be used to test
 * plugin API calls without a real backend.
 * 
 * @example
 * ```typescript
 * import { createTestServer } from '@naap/plugin-sdk/testing';
 * 
 * const server = createTestServer()
 *   .get('/api/items', () => ({
 *     body: [{ id: '1', name: 'Item 1' }],
 *   }))
 *   .post('/api/items', (req) => ({
 *     status: 201,
 *     body: { id: '2', ...req.body },
 *   }));
 * 
 * const client = server.createApiClient();
 * const items = await client.get('/api/items');
 * // items === [{ id: '1', name: 'Item 1' }]
 * ```
 */
export function createTestServer(): MockServer {
  const registeredRoutes: MockRoute[] = [];
  const callHistory: Array<{ method: string; path: string; body?: unknown }> = [];

  function matchRoute(method: string, path: string): { route: MockRoute; params: Record<string, string> } | null {
    for (const route of registeredRoutes) {
      if (route.method !== method.toUpperCase()) continue;

      // Simple path matching with :param support
      const routeParts = route.path.split('/');
      const pathParts = path.split('?')[0].split('/');

      if (routeParts.length !== pathParts.length) continue;

      const params: Record<string, string> = {};
      let match = true;

      for (let i = 0; i < routeParts.length; i++) {
        if (routeParts[i].startsWith(':')) {
          params[routeParts[i].slice(1)] = pathParts[i];
        } else if (routeParts[i] !== pathParts[i]) {
          match = false;
          break;
        }
      }

      if (match) return { route, params };
    }
    return null;
  }

  function parseQuery(path: string): Record<string, string> {
    const [, queryStr] = path.split('?');
    if (!queryStr) return {};
    const params: Record<string, string> = {};
    for (const pair of queryStr.split('&')) {
      const [key, val] = pair.split('=');
      params[decodeURIComponent(key)] = decodeURIComponent(val || '');
    }
    return params;
  }

  const server: MockServer = {
    get(path, handler) {
      registeredRoutes.push({ method: 'GET', path, handler });
      return server;
    },
    post(path, handler) {
      registeredRoutes.push({ method: 'POST', path, handler });
      return server;
    },
    put(path, handler) {
      registeredRoutes.push({ method: 'PUT', path, handler });
      return server;
    },
    delete(path, handler) {
      registeredRoutes.push({ method: 'DELETE', path, handler });
      return server;
    },
    patch(path, handler) {
      registeredRoutes.push({ method: 'PATCH', path, handler });
      return server;
    },

    async handle(method, path, body, headers = {}) {
      callHistory.push({ method, path, body });

      const matched = matchRoute(method, path);
      if (!matched) {
        return { status: 404, body: { error: 'Not Found', path } };
      }

      const req: MockRequest = {
        method,
        path,
        headers,
        body,
        params: matched.params,
        query: parseQuery(path),
      };

      try {
        const response = await matched.route.handler(req);
        return { status: 200, ...response };
      } catch (err) {
        return {
          status: 500,
          body: { error: err instanceof Error ? err.message : String(err) },
        };
      }
    },

    routes() {
      return [...registeredRoutes];
    },

    createApiClient() {
      return {
        async get<T>(url: string): Promise<T> {
          const res = await server.handle('GET', url);
          if (res.status && res.status >= 400) throw new Error(JSON.stringify(res.body));
          return res.body as T;
        },
        async post<T>(url: string, body?: unknown): Promise<T> {
          const res = await server.handle('POST', url, body);
          if (res.status && res.status >= 400) throw new Error(JSON.stringify(res.body));
          return res.body as T;
        },
        async put<T>(url: string, body?: unknown): Promise<T> {
          const res = await server.handle('PUT', url, body);
          if (res.status && res.status >= 400) throw new Error(JSON.stringify(res.body));
          return res.body as T;
        },
        async delete<T>(url: string): Promise<T> {
          const res = await server.handle('DELETE', url);
          if (res.status && res.status >= 400) throw new Error(JSON.stringify(res.body));
          return res.body as T;
        },
        async patch<T>(url: string, body?: unknown): Promise<T> {
          const res = await server.handle('PATCH', url, body);
          if (res.status && res.status >= 400) throw new Error(JSON.stringify(res.body));
          return res.body as T;
        },
      };
    },

    reset() {
      registeredRoutes.length = 0;
      callHistory.length = 0;
    },

    calls() {
      return [...callHistory];
    },
  };

  return server;
}
