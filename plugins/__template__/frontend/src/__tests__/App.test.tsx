/**
 * Plugin Test Template
 *
 * This template demonstrates how to test a NAAP plugin using the SDK testing utilities.
 * Copy this file to your plugin's __tests__ directory and modify as needed.
 *
 * Available testing utilities from @naap/plugin-sdk/testing:
 * - MockShellProvider: Wraps components with mock shell context
 * - renderWithShell: Render helper that includes MockShellProvider
 * - createMockUser: Factory for mock user objects
 * - createMockTeam: Factory for mock team objects
 * - createMockConfig: Factory for mock plugin config
 * - createTestServer: Mock API server for backend testing
 * - testPluginContract: Contract tests for plugin interface
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MockShellProvider,
  renderWithShell,
  createMockUser,
  createMockTeam,
  createMockTeamMember,
  createMockConfig,
  createTestServer,
  testPluginContract,
  createMockQuerySuccess,
  createMockQueryLoading,
} from '@naap/plugin-sdk/testing';

// Import your plugin component
// import App from '../App';

// ============================================
// Example Component for Testing
// ============================================

// This is an example component - replace with your actual component
function ExamplePluginComponent() {
  return (
    <div>
      <h1>My Plugin</h1>
      <p>Welcome to the plugin</p>
    </div>
  );
}

// ============================================
// Basic Rendering Tests
// ============================================

describe('Plugin Component', () => {
  it('renders without crashing', () => {
    render(
      <MockShellProvider>
        <ExamplePluginComponent />
      </MockShellProvider>
    );

    expect(screen.getByText('My Plugin')).toBeInTheDocument();
  });

  it('renders with custom user', () => {
    const customUser = createMockUser({
      displayName: 'John Doe',
      roles: ['admin'],
    });

    render(
      <MockShellProvider
        context={{
          auth: {
            getUser: () => customUser,
            isAuthenticated: () => true,
            hasRole: (role) => customUser.roles.includes(role),
            hasPermission: () => true,
            getToken: async () => 'mock-token',
            onAuthStateChange: () => () => {},
          },
        }}
      >
        <ExamplePluginComponent />
      </MockShellProvider>
    );

    expect(screen.getByText('My Plugin')).toBeInTheDocument();
  });
});

// ============================================
// Team Context Tests
// ============================================

describe('Team Context', () => {
  it('renders with team context', () => {
    const team = createMockTeam({
      name: 'Engineering Team',
      slug: 'engineering',
    });

    const member = createMockTeamMember({
      role: 'admin',
    });

    render(
      <MockShellProvider
        context={{
          teamContext: {
            currentTeam: team,
            currentMember: member,
            hasTeamPermission: () => true,
          },
        }}
      >
        <ExamplePluginComponent />
      </MockShellProvider>
    );

    expect(screen.getByText('My Plugin')).toBeInTheDocument();
  });

  it('handles missing team context', () => {
    render(
      <MockShellProvider
        context={{
          teamContext: {
            currentTeam: null,
            currentMember: null,
          },
        }}
      >
        <ExamplePluginComponent />
      </MockShellProvider>
    );

    expect(screen.getByText('My Plugin')).toBeInTheDocument();
  });
});

// ============================================
// Plugin Config Tests
// ============================================

describe('Plugin Configuration', () => {
  it('uses plugin config from context', () => {
    const config = createMockConfig({
      data: {
        theme: 'dark',
        apiEndpoint: 'https://api.example.com',
        features: ['feature1', 'feature2'],
      },
    });

    render(
      <MockShellProvider
        pluginConfig={{
          config: config.data,
          loading: false,
          error: null,
        }}
      >
        <ExamplePluginComponent />
      </MockShellProvider>
    );

    expect(screen.getByText('My Plugin')).toBeInTheDocument();
  });

  it('shows loading state while config is loading', () => {
    render(
      <MockShellProvider
        pluginConfig={{
          config: {},
          loading: true,
          error: null,
        }}
      >
        <ExamplePluginComponent />
      </MockShellProvider>
    );

    // Plugin should still render even with loading config
    expect(screen.getByText('My Plugin')).toBeInTheDocument();
  });
});

// ============================================
// API Interaction Tests
// ============================================

describe('API Interactions', () => {
  let server: ReturnType<typeof createTestServer>;

  beforeEach(() => {
    server = createTestServer()
      .get('/api/plugin/items', () => ({
        body: {
          success: true,
          data: [
            { id: '1', name: 'Item 1' },
            { id: '2', name: 'Item 2' },
          ],
        },
      }))
      .post('/api/plugin/items', (req) => ({
        status: 201,
        body: {
          success: true,
          data: { id: '3', ...(req.body as object) },
        },
      }))
      .delete('/api/plugin/items/:id', (req) => ({
        body: { success: true, id: req.params.id },
      }));
  });

  afterEach(() => {
    server.reset();
  });

  it('fetches data from API', async () => {
    const client = server.createApiClient();

    const response = await client.get<{ success: boolean; data: Array<{ id: string; name: string }> }>(
      '/api/plugin/items'
    );

    expect(response.success).toBe(true);
    expect(response.data).toHaveLength(2);
    expect(response.data[0].name).toBe('Item 1');
  });

  it('creates item via API', async () => {
    const client = server.createApiClient();

    const response = await client.post<{ success: boolean; data: { id: string; name: string } }>(
      '/api/plugin/items',
      { name: 'New Item' }
    );

    expect(response.success).toBe(true);
    expect(response.data.id).toBe('3');
    expect(response.data.name).toBe('New Item');
  });

  it('tracks API call history', async () => {
    const client = server.createApiClient();

    await client.get('/api/plugin/items');
    await client.post('/api/plugin/items', { name: 'Test' });

    const calls = server.calls();
    expect(calls).toHaveLength(2);
    expect(calls[0].method).toBe('GET');
    expect(calls[1].method).toBe('POST');
    expect(calls[1].body).toEqual({ name: 'Test' });
  });
});

// ============================================
// Event Bus Tests
// ============================================

describe('Event Bus', () => {
  it('emits and receives events', () => {
    const handler = vi.fn();

    const { shellContext } = renderWithShell(<ExamplePluginComponent />);

    // Subscribe to event
    shellContext.eventBus.on('test:event', handler);

    // Emit event
    shellContext.eventBus.emit('test:event', { data: 'test' });

    expect(handler).toHaveBeenCalledWith({ data: 'test' });
  });

  it('handles request/response pattern', async () => {
    const { shellContext } = renderWithShell(<ExamplePluginComponent />);

    // Register handler
    shellContext.eventBus.handleRequest('plugin:get-data', async (data: { id: string }) => {
      return { id: data.id, name: 'Test Item' };
    });

    // Make request
    const result = await shellContext.eventBus.request<{ id: string }, { id: string; name: string }>(
      'plugin:get-data',
      { id: '123' }
    );

    expect(result).toEqual({ id: '123', name: 'Test Item' });
  });
});

// ============================================
// Notification Tests
// ============================================

describe('Notifications', () => {
  it('shows success notification', () => {
    const { shellContext } = renderWithShell(<ExamplePluginComponent />);

    shellContext.notifications.success('Operation completed!');

    expect(shellContext.notifications.success).toHaveBeenCalledWith('Operation completed!');
  });

  it('shows error notification', () => {
    const { shellContext } = renderWithShell(<ExamplePluginComponent />);

    shellContext.notifications.error('Something went wrong');

    expect(shellContext.notifications.error).toHaveBeenCalledWith('Something went wrong');
  });
});

// ============================================
// Navigation Tests
// ============================================

describe('Navigation', () => {
  it('navigates to path', () => {
    const { shellContext } = renderWithShell(<ExamplePluginComponent />);

    shellContext.navigate('/settings');

    expect(shellContext.navigate).toHaveBeenCalledWith('/settings');
  });
});

// ============================================
// Query State Tests
// ============================================

describe('Query States', () => {
  it('provides loading query state', () => {
    const queryStates = new Map([
      ['items', createMockQueryLoading()],
    ]);

    render(
      <MockShellProvider queryStates={queryStates}>
        <ExamplePluginComponent />
      </MockShellProvider>
    );

    expect(screen.getByText('My Plugin')).toBeInTheDocument();
  });

  it('provides successful query state', () => {
    const queryStates = new Map([
      ['items', createMockQuerySuccess([{ id: '1', name: 'Item 1' }])],
    ]);

    render(
      <MockShellProvider queryStates={queryStates}>
        <ExamplePluginComponent />
      </MockShellProvider>
    );

    expect(screen.getByText('My Plugin')).toBeInTheDocument();
  });
});

// ============================================
// Contract Tests
// ============================================

describe('Plugin Contract', () => {
  // Uncomment this to run contract tests on your plugin
  // testPluginContract(() => import('../mount'));

  it('exports mount function', async () => {
    // Example of manual contract testing
    // const module = await import('../mount');
    // expect(typeof module.mount).toBe('function');
    expect(true).toBe(true); // Placeholder
  });
});

// ============================================
// renderWithShell Helper Examples
// ============================================

describe('renderWithShell Helper', () => {
  it('provides shell context for assertions', () => {
    const { shellContext } = renderWithShell(<ExamplePluginComponent />);

    expect(shellContext.auth.isAuthenticated()).toBe(true);
    expect(shellContext.version).toBe('1.0.0-test');
  });

  it('supports initial path for routing', () => {
    const { shellContext } = renderWithShell(<ExamplePluginComponent />, {
      initialPath: '/settings',
    });

    expect(screen.getByText('My Plugin')).toBeInTheDocument();
  });

  it('supports custom context overrides', () => {
    const { shellContext } = renderWithShell(<ExamplePluginComponent />, {
      context: {
        version: '2.0.0-custom',
      },
    });

    expect(shellContext.version).toBe('2.0.0-custom');
  });
});

// ============================================
// Permission Tests
// ============================================

describe('Permissions', () => {
  it('checks permissions', () => {
    const { shellContext } = renderWithShell(<ExamplePluginComponent />);

    expect(shellContext.permissions.can('items', 'read')).toBe(true);
  });

  it('denies permission when configured', () => {
    const { shellContext } = renderWithShell(<ExamplePluginComponent />, {
      context: {
        permissions: {
          can: vi.fn().mockReturnValue(false),
          getPermissions: vi.fn().mockReturnValue([]),
          require: vi.fn(),
        },
      },
    });

    expect(shellContext.permissions.can('items', 'delete')).toBe(false);
  });
});

// ============================================
// Theme Tests
// ============================================

describe('Theme', () => {
  it('provides theme context', () => {
    const { shellContext } = renderWithShell(<ExamplePluginComponent />);

    expect(shellContext.theme.mode).toBe('dark');
  });

  it('toggles theme', () => {
    const { shellContext } = renderWithShell(<ExamplePluginComponent />);

    shellContext.theme.toggle();

    expect(shellContext.theme.toggle).toHaveBeenCalled();
  });
});
