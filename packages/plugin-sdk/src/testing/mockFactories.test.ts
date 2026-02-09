/**
 * Tests for Mock Factories
 */

import { describe, it, expect } from 'vitest';
import {
  createMockUser,
  createMockTeam,
  createMockTeamMember,
  createMockPlugin,
  createMockConfig,
  createMockTenantInstallation,
  createMockApiSuccess,
  createMockApiError,
  createMockQueryLoading,
  createMockQuerySuccess,
  createMockQueryError,
} from './mockFactories.js';

describe('createMockUser', () => {
  it('creates a default user', () => {
    const user = createMockUser();

    expect(user.id).toBe('mock-user-id');
    expect(user.email).toBe('test@example.com');
    expect(user.displayName).toBe('Test User');
    expect(user.roles).toEqual(['user']);
    expect(user.permissions).toEqual([]);
  });

  it('allows overriding properties', () => {
    const user = createMockUser({
      id: 'custom-id',
      displayName: 'John Doe',
      roles: ['admin', 'user'],
      permissions: [{ resource: 'posts', action: 'write' }],
    });

    expect(user.id).toBe('custom-id');
    expect(user.displayName).toBe('John Doe');
    expect(user.roles).toEqual(['admin', 'user']);
    expect(user.permissions).toEqual([{ resource: 'posts', action: 'write' }]);
  });

  it('supports wallet address', () => {
    const user = createMockUser({
      walletAddress: '0x1234567890abcdef',
    });

    expect(user.walletAddress).toBe('0x1234567890abcdef');
  });
});

describe('createMockTeam', () => {
  it('creates a default team', () => {
    const team = createMockTeam();

    expect(team.id).toBe('mock-team-id');
    expect(team.name).toBe('Test Team');
    expect(team.slug).toBe('test-team');
    expect(team.ownerId).toBe('mock-user-id');
  });

  it('allows overriding properties', () => {
    const team = createMockTeam({
      name: 'Engineering',
      slug: 'engineering',
      description: 'The engineering team',
    });

    expect(team.name).toBe('Engineering');
    expect(team.slug).toBe('engineering');
    expect(team.description).toBe('The engineering team');
  });
});

describe('createMockTeamMember', () => {
  it('creates a default member', () => {
    const member = createMockTeamMember();

    expect(member.id).toBe('mock-member-id');
    expect(member.userId).toBe('mock-user-id');
    expect(member.teamId).toBe('mock-team-id');
    expect(member.role).toBe('member');
  });

  it('allows setting role', () => {
    const admin = createMockTeamMember({ role: 'admin' });
    const owner = createMockTeamMember({ role: 'owner' });

    expect(admin.role).toBe('admin');
    expect(owner.role).toBe('owner');
  });
});

describe('createMockPlugin', () => {
  it('creates a default plugin', () => {
    const plugin = createMockPlugin();

    expect(plugin.id).toBe('mock-plugin-id');
    expect(plugin.name).toBe('test-plugin');
    expect(plugin.displayName).toBe('Test Plugin');
    expect(plugin.version).toBe('1.0.0');
    expect(plugin.enabled).toBe(true);
    expect(plugin.installed).toBe(true);
  });

  it('allows disabling plugin', () => {
    const plugin = createMockPlugin({ enabled: false });

    expect(plugin.enabled).toBe(false);
  });
});

describe('createMockConfig', () => {
  it('creates a default config', () => {
    const config = createMockConfig();

    expect(config.data).toEqual({});
    expect(config.scope).toBe('personal');
    expect(config.version).toBe(1);
  });

  it('allows typed config data', () => {
    interface MyConfig {
      theme: 'light' | 'dark';
      apiKey: string;
    }

    const config = createMockConfig<MyConfig>({
      data: { theme: 'dark', apiKey: 'abc123' },
    });

    expect(config.data.theme).toBe('dark');
    expect(config.data.apiKey).toBe('abc123');
  });

  it('supports different scopes', () => {
    const teamConfig = createMockConfig({ scope: 'team' });
    const tenantConfig = createMockConfig({ scope: 'tenant' });

    expect(teamConfig.scope).toBe('team');
    expect(tenantConfig.scope).toBe('tenant');
  });
});

describe('createMockTenantInstallation', () => {
  it('creates a default installation', () => {
    const installation = createMockTenantInstallation();

    expect(installation.id).toBe('mock-installation-id');
    expect(installation.pluginName).toBe('test-plugin');
    expect(installation.enabled).toBe(true);
    expect(installation.config).toEqual({});
  });

  it('allows custom config', () => {
    const installation = createMockTenantInstallation({
      pluginName: 'my-wallet',
      config: { currency: 'USD' },
    });

    expect(installation.pluginName).toBe('my-wallet');
    expect(installation.config).toEqual({ currency: 'USD' });
  });
});

describe('API Response Factories', () => {
  it('creates successful response', () => {
    const response = createMockApiSuccess({ items: [1, 2, 3] });

    expect(response.success).toBe(true);
    expect(response.data).toEqual({ items: [1, 2, 3] });
    expect(response.error).toBeUndefined();
  });

  it('creates error response', () => {
    const response = createMockApiError('Not found');

    expect(response.success).toBe(false);
    expect(response.error).toBe('Not found');
    expect(response.data).toBeUndefined();
  });
});

describe('Query State Factories', () => {
  it('creates loading state', () => {
    const state = createMockQueryLoading();

    expect(state.loading).toBe(true);
    expect(state.data).toBeUndefined();
    expect(state.error).toBeNull();
    expect(state.isSuccess).toBe(false);
  });

  it('creates success state', () => {
    const state = createMockQuerySuccess({ id: '1', name: 'Test' });

    expect(state.loading).toBe(false);
    expect(state.data).toEqual({ id: '1', name: 'Test' });
    expect(state.error).toBeNull();
    expect(state.isSuccess).toBe(true);
    expect(state.isStale).toBe(false);
  });

  it('creates stale success state', () => {
    const state = createMockQuerySuccess({ id: '1' }, true);

    expect(state.isStale).toBe(true);
  });

  it('creates error state from string', () => {
    const state = createMockQueryError('Something went wrong');

    expect(state.loading).toBe(false);
    expect(state.error).toBeInstanceOf(Error);
    expect(state.error?.message).toBe('Something went wrong');
    expect(state.isSuccess).toBe(false);
  });

  it('creates error state from Error', () => {
    const error = new Error('Custom error');
    const state = createMockQueryError(error);

    expect(state.error).toBe(error);
  });
});
