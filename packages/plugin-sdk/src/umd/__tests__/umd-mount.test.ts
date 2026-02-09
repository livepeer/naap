/**
 * Tests for UMD Plugin Mount Helper
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  createUMDPluginMount,
  createUMDPlugin,
  registerUMDPlugin,
  type UMDPluginModule,
  type ShellContext,
} from '../index';

// Mock ShellContext for testing
const createMockShellContext = (): ShellContext => ({
  auth: {
    getUser: vi.fn().mockReturnValue({ id: 'user-1', displayName: 'Test User' }),
    getToken: vi.fn().mockReturnValue('mock-token'),
    isAuthenticated: vi.fn().mockReturnValue(true),
    hasRole: vi.fn().mockReturnValue(true),
    hasPermission: vi.fn().mockReturnValue(true),
    login: vi.fn(),
    logout: vi.fn(),
    getCurrentTeam: vi.fn().mockReturnValue({ id: 'team-1', name: 'Test Team' }),
    getTenant: vi.fn().mockReturnValue({ id: 'tenant-1', name: 'Test Tenant' }),
  },
  notifications: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
  },
  navigate: vi.fn(),
  eventBus: {
    emit: vi.fn(),
    on: vi.fn().mockReturnValue(vi.fn()),
    off: vi.fn(),
    once: vi.fn(),
  },
  theme: {
    mode: 'light' as const,
    primaryColor: '#3b82f6',
    accentColor: '#10b981',
    getMode: vi.fn().mockReturnValue('light'),
    setMode: vi.fn(),
    toggle: vi.fn(),
  },
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
  permissions: {
    can: vi.fn().mockReturnValue(true),
    hasRole: vi.fn().mockReturnValue(true),
    getRoles: vi.fn().mockReturnValue(['admin']),
    getPermissions: vi.fn().mockReturnValue([]),
  },
  integrations: {
    ai: {} as any,
    storage: {} as any,
    email: {} as any,
    getIntegration: vi.fn(),
    listIntegrations: vi.fn().mockReturnValue([]),
  },
  capabilities: {
    has: vi.fn().mockReturnValue(true),
    info: vi.fn().mockReturnValue({ available: true, configured: true }),
    getAll: vi.fn().mockReturnValue({}),
    hasAll: vi.fn().mockReturnValue(true),
    hasAny: vi.fn().mockReturnValue(true),
  },
  shellVersion: '1.0.0',
  pluginBasePath: '/plugins/test-plugin',
});

// Simple test component
const TestApp: React.FC<{ context?: ShellContext }> = ({ context }) => {
  return React.createElement('div', { 'data-testid': 'test-app' }, 'Test Plugin');
};

describe('createUMDPluginMount', () => {
  let container: HTMLElement;
  let mockContext: ShellContext;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mockContext = createMockShellContext();
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('should create a plugin module with mount function', () => {
    const plugin = createUMDPluginMount(React, ReactDOM, { App: TestApp });

    expect(plugin).toHaveProperty('mount');
    expect(plugin).toHaveProperty('unmount');
    expect(typeof plugin.mount).toBe('function');
    expect(typeof plugin.unmount).toBe('function');
  });

  it('should mount the plugin to the container', async () => {
    const plugin = createUMDPluginMount(React, ReactDOM, { App: TestApp });

    plugin.mount(container, mockContext);

    // Wait for React to render
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(container.innerHTML).toContain('Test Plugin');
  });

  it('should return a cleanup function from mount', () => {
    const plugin = createUMDPluginMount(React, ReactDOM, { App: TestApp });

    const cleanup = plugin.mount(container, mockContext);

    expect(typeof cleanup).toBe('function');
  });

  it('should unmount the plugin when cleanup is called', () => {
    const plugin = createUMDPluginMount(React, ReactDOM, { App: TestApp });

    const cleanup = plugin.mount(container, mockContext);
    cleanup?.();

    expect(container.innerHTML).toBe('');
  });

  it('should call onMount callback', () => {
    const onMount = vi.fn();
    const plugin = createUMDPluginMount(React, ReactDOM, { App: TestApp, onMount });

    plugin.mount(container, mockContext);

    expect(onMount).toHaveBeenCalledWith(mockContext);
  });

  it('should call onUnmount callback', () => {
    const onUnmount = vi.fn();
    const plugin = createUMDPluginMount(React, ReactDOM, { App: TestApp, onUnmount });

    const cleanup = plugin.mount(container, mockContext);
    cleanup?.();

    expect(onUnmount).toHaveBeenCalled();
  });

  it('should call onInit if provided', () => {
    const onInit = vi.fn();
    const plugin = createUMDPluginMount(React, ReactDOM, { App: TestApp, onInit });

    plugin.mount(container, mockContext);

    expect(onInit).toHaveBeenCalledWith(mockContext);
  });

  it('should wrap with custom wrapper if provided', async () => {
    const Wrapper: React.FC<{ children: React.ReactNode; context: ShellContext }> = ({
      children,
    }) => {
      return React.createElement('div', { 'data-testid': 'wrapper' }, children);
    };

    const plugin = createUMDPluginMount(React, ReactDOM, { App: TestApp, wrapper: Wrapper });

    plugin.mount(container, mockContext);

    // Wait for React to render
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(container.innerHTML).toContain('data-testid="wrapper"');
  });
});

describe('createUMDPlugin', () => {
  let container: HTMLElement;
  let mockContext: ShellContext;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mockContext = createMockShellContext();
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('should create a plugin with metadata', () => {
    const plugin = createUMDPlugin(React, ReactDOM, {
      name: 'test-plugin',
      version: '1.0.0',
      App: TestApp,
    });

    expect(plugin.metadata).toEqual({
      name: 'test-plugin',
      version: '1.0.0',
    });
  });

  it('should have mount and unmount functions', () => {
    const plugin = createUMDPlugin(React, ReactDOM, {
      name: 'test-plugin',
      version: '1.0.0',
      App: TestApp,
    });

    expect(typeof plugin.mount).toBe('function');
    expect(typeof plugin.unmount).toBe('function');
  });
});

describe('registerUMDPlugin', () => {
  const originalWindow = global.window;

  beforeEach(() => {
    // Reset window for each test
    (global as any).window = { React, ReactDOM };
  });

  afterEach(() => {
    // Restore original window
    (global as any).window = originalWindow;
  });

  it('should register plugin factory on window', () => {
    const createFn = vi.fn().mockReturnValue({ mount: vi.fn(), unmount: vi.fn() });

    registerUMDPlugin('testPlugin', createFn);

    expect((window as any).__naap_plugin_testPlugin).toBe(createFn);
  });

  it('should initialize plugin if React is available', () => {
    const mockPlugin = { mount: vi.fn(), unmount: vi.fn() };
    const createFn = vi.fn().mockReturnValue(mockPlugin);

    registerUMDPlugin('testPlugin2', createFn);

    expect(createFn).toHaveBeenCalledWith(React, ReactDOM);
    expect((window as any).testPlugin2).toBe(mockPlugin);
  });
});
