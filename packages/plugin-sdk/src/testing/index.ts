/**
 * Plugin SDK Testing Utilities
 *
 * Provides mock providers and utilities for testing plugins.
 *
 * @example
 * ```typescript
 * import {
 *   MockShellProvider,
 *   createMockShellContext,
 *   renderWithShell,
 *   createMockUser,
 *   createMockTeam,
 *   createMockConfig,
 * } from '@naap/plugin-sdk/testing';
 * import { testPluginContract, runContractTests } from '@naap/plugin-sdk/testing';
 * import { createTestServer } from '@naap/plugin-sdk/testing';
 * ```
 */

export {
  MockShellProvider,
  createMockShellContext,
  createTestShellContext,
  renderWithShell,
  createTestServer,
  // Phase 7: Context exports for hook mocking
  MockPluginConfigContext,
  MockQueryContext,
  useMockPluginConfig,
  useMockQuery,
  type MockShellProviderProps,
  type RenderWithShellOptions,
  type MockTeamContextOptions,
  type MockTenantServiceOptions,
  type MockPluginConfigState,
  type MockQueryState,
} from './MockShellProvider.js';

// Phase 7: Mock factories
export {
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
  type CreateMockUserOptions,
  type CreateMockTeamOptions,
  type CreateMockTeamMemberOptions,
  type CreateMockPluginOptions,
  type CreateMockConfigOptions,
  type CreateMockTenantInstallationOptions,
  type MockTeam,
  type MockTeamMember,
  type MockPlugin,
  type MockConfig,
  type MockTenantInstallation,
  type MockApiResponse,
  type TeamRole,
} from './mockFactories.js';

// Phase 2: Contract testing utilities
export {
  runContractTests,
  testPluginContract,
  assertions,
  type PluginModule,
  type ContractTestOptions,
  type ContractTestResult,
} from './contractTests.js';

/**
 * Test utilities for plugin testing
 */
export const testUtils = {
  /**
   * Wait for async operations to complete
   */
  waitForAsync: () => new Promise((resolve) => setTimeout(resolve, 0)),

  /**
   * Wait for a specific number of milliseconds
   */
  wait: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),

  /**
   * Create a mock file for upload testing
   */
  createMockFile: (name = 'test.txt', content = 'test content', type = 'text/plain'): File => {
    const blob = new Blob([content], { type });
    return new File([blob], name, { type });
  },

  /**
   * Create a mock event for testing event handlers
   */
  createMockEvent: <T = unknown>(data: T) => ({
    data,
    preventDefault: () => {},
    stopPropagation: () => {},
  }),

  /**
   * Phase 6c: Flush all pending promises and microtasks
   */
  flushPromises: () => new Promise((resolve) => setTimeout(resolve, 0)),

  /**
   * Phase 6c: Create a deferred promise (useful for controlling async flow in tests)
   */
  createDeferred: <T = void>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  },

  /**
   * Phase 7: Wait for act() to complete (for React state updates)
   */
  actWait: async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  },
};
