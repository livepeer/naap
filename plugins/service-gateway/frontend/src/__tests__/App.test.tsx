import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  MockShellProvider,
  renderWithShell,
  createMockUser,
  createMockTeam,
  createMockTeamMember,
  testPluginContract,
} from '@naap/plugin-sdk/testing';

describe('Service Gateway Plugin', () => {
  // ──────────────────────────────────────────────
  // Contract Tests
  // ──────────────────────────────────────────────

  describe('Plugin Contract', () => {
    testPluginContract(() => import('../App'));

    it('exports mount function from App.tsx', async () => {
      const module = await import('../App');
      expect(typeof module.mount).toBe('function');
    });

    it('exports plugin manifest from App.tsx', async () => {
      const module = await import('../App');
      expect(module.manifest).toBeDefined();
      expect(module.manifest).toHaveProperty('mount');
    });

    it('exports default plugin object', async () => {
      const module = await import('../App');
      expect(module.default).toBeDefined();
      expect(typeof module.default.mount).toBe('function');
    });
  });

  // ──────────────────────────────────────────────
  // UMD Mount Entry
  // ──────────────────────────────────────────────

  describe('UMD Mount Entry', () => {
    it('exports mount from mount.tsx', async () => {
      const module = await import('../mount');
      expect(typeof module.mount).toBe('function');
    });

    it('exports unmount from mount.tsx', async () => {
      const module = await import('../mount');
      expect(typeof module.unmount).toBe('function');
    });

    it('exports metadata with plugin name', async () => {
      const module = await import('../mount');
      expect(module.metadata).toBeDefined();
      expect(module.metadata.name).toBe('serviceGateway');
    });
  });
});

describe('GatewayApp Rendering', () => {
  // ──────────────────────────────────────────────
  // Basic Rendering
  // ──────────────────────────────────────────────

  it('mounts without crashing via createPlugin', async () => {
    const module = await import('../App');
    const container = document.createElement('div');
    document.body.appendChild(container);

    const { createMockShellContext } = await import('@naap/plugin-sdk/testing');
    const context = createMockShellContext();

    let cleanup: (() => void) | void;
    expect(() => {
      cleanup = module.default.mount(container, context) as (() => void) | void;
    }).not.toThrow();

    if (typeof cleanup === 'function') cleanup();
    document.body.removeChild(container);
  });
});

describe('TeamGuard', () => {
  // useTeam() starts with currentTeam=null and only updates via events.
  // In test context without emitting team:change, it always shows personal scope.

  it('renders children regardless of team state', async () => {
    const { TeamGuard } = await import('../components/TeamGuard');

    render(
      <MockShellProvider>
        <TeamGuard>
          <div>Gateway Content</div>
        </TeamGuard>
      </MockShellProvider>
    );

    expect(screen.getByText('Gateway Content')).toBeInTheDocument();
  });

  it('shows personal scope banner when no team is set', async () => {
    const { TeamGuard } = await import('../components/TeamGuard');

    render(
      <MockShellProvider>
        <TeamGuard>
          <div>Gateway Content</div>
        </TeamGuard>
      </MockShellProvider>
    );

    expect(screen.getByText('Gateway Content')).toBeInTheDocument();
    expect(screen.getByText(/Personal scope/)).toBeInTheDocument();
  });
});
