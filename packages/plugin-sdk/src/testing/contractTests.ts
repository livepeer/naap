/**
 * Plugin Contract Tests
 * 
 * Phase 2: Contract test utilities for verifying plugins implement
 * the PluginModule interface correctly.
 * 
 * Usage:
 * ```typescript
 * import { testPluginContract } from '@naap/plugin-sdk/testing';
 * 
 * describe('MyPlugin Contract', () => {
 *   testPluginContract(() => import('../src/App'));
 * });
 * ```
 */

import type { ShellContext } from '../types/context.js';
import { createMockShellContext } from './MockShellProvider.js';

// ============================================
// Types
// ============================================

/**
 * Plugin module interface that all plugins must implement
 */
export interface PluginModule {
  /**
   * Mount the plugin into a container element
   * @param container - DOM element to mount into
   * @param context - Shell context with services
   * @returns Optional cleanup function
   */
  mount: (container: HTMLElement, context: ShellContext) => void | (() => void) | Promise<void | (() => void)>;
  
  /**
   * Optional: Initialize plugin before mounting (async setup)
   * @param context - Shell context
   */
  init?: (context: ShellContext) => void | Promise<void>;
  
  /**
   * Optional: Cleanup when plugin is unloaded from memory
   */
  cleanup?: () => void | Promise<void>;
  
  /**
   * Optional: Plugin metadata
   */
  metadata?: {
    name?: string;
    version?: string;
    description?: string;
  };
}

export interface ContractTestOptions {
  /** Timeout for mount operations (default: 5000ms) */
  timeout?: number;
  /** Custom shell context for testing */
  shellContext?: ShellContext;
  /** Whether to test async operations */
  testAsync?: boolean;
  /** Custom assertions to run */
  customAssertions?: (module: PluginModule, container: HTMLElement) => void | Promise<void>;
}

export interface ContractTestResult {
  passed: boolean;
  tests: Array<{
    name: string;
    passed: boolean;
    error?: string;
  }>;
  duration: number;
}

// ============================================
// Contract Test Runner
// ============================================

/**
 * Run contract tests against a plugin module
 * 
 * @param getModule - Function that returns the plugin module (dynamic import)
 * @param options - Test options
 * @returns Test results
 * 
 * @example
 * ```typescript
 * const results = await runContractTests(
 *   () => import('../src/App'),
 *   { timeout: 10000 }
 * );
 * 
 * expect(results.passed).toBe(true);
 * ```
 */
export async function runContractTests(
  getModule: () => Promise<{ default?: PluginModule } | PluginModule>,
  options: ContractTestOptions = {}
): Promise<ContractTestResult> {
  const {
    timeout = 5000,
    shellContext = createMockShellContext(),
    testAsync = true,
  } = options;
  
  const startTime = Date.now();
  const tests: ContractTestResult['tests'] = [];
  
  // Helper to add test result
  const addTest = (name: string, passed: boolean, error?: string) => {
    tests.push({ name, passed, error });
  };
  
  try {
    // Test 1: Module loads successfully
    let module: PluginModule;
    try {
      const imported = await Promise.race([
        getModule(),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Module load timeout')), timeout)
        ),
      ]);
      
      // Handle both default and named exports
      module = 'default' in imported ? (imported.default as PluginModule) : imported as PluginModule;
      addTest('Module loads successfully', true);
    } catch (error) {
      addTest('Module loads successfully', false, String(error));
      return { passed: false, tests, duration: Date.now() - startTime };
    }
    
    // Test 2: Module exports mount function
    if (typeof module.mount !== 'function') {
      addTest('Module exports mount() function', false, 'mount is not a function');
      return { passed: false, tests, duration: Date.now() - startTime };
    }
    addTest('Module exports mount() function', true);
    
    // Test 3: mount() accepts correct arguments
    const container = document.createElement('div');
    container.id = 'plugin-test-container';
    document.body.appendChild(container);
    
    let unmount: (() => void) | void;
    try {
      const mountResult = module.mount(container, shellContext);
      
      if (testAsync && mountResult instanceof Promise) {
        unmount = await Promise.race([
          mountResult,
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Mount timeout')), timeout)
          ),
        ]);
      } else {
        unmount = mountResult as (() => void) | void;
      }
      
      addTest('mount() executes without error', true);
    } catch (error) {
      addTest('mount() executes without error', false, String(error));
    } finally {
      // Cleanup
      if (typeof unmount === 'function') {
        try {
          unmount();
          addTest('Unmount function executes without error', true);
        } catch (error) {
          addTest('Unmount function executes without error', false, String(error));
        }
      }
      document.body.removeChild(container);
    }
    
    // Test 4: init() function (if present)
    if (module.init) {
      if (typeof module.init !== 'function') {
        addTest('init() is a valid function', false, 'init is not a function');
      } else {
        try {
          const initResult = module.init(shellContext);
          if (testAsync && initResult instanceof Promise) {
            await Promise.race([
              initResult,
              new Promise<never>((_, reject) => 
                setTimeout(() => reject(new Error('Init timeout')), timeout)
              ),
            ]);
          }
          addTest('init() executes without error', true);
        } catch (error) {
          addTest('init() executes without error', false, String(error));
        }
      }
    }
    
    // Test 5: cleanup() function (if present)
    if (module.cleanup) {
      if (typeof module.cleanup !== 'function') {
        addTest('cleanup() is a valid function', false, 'cleanup is not a function');
      } else {
        try {
          const cleanupResult = module.cleanup();
          if (testAsync && cleanupResult instanceof Promise) {
            await cleanupResult;
          }
          addTest('cleanup() executes without error', true);
        } catch (error) {
          addTest('cleanup() executes without error', false, String(error));
        }
      }
    }
    
    // Test 6: Custom assertions (if provided)
    if (options.customAssertions) {
      const testContainer = document.createElement('div');
      document.body.appendChild(testContainer);
      
      try {
        const mountResult = module.mount(testContainer, shellContext);
        if (testAsync && mountResult instanceof Promise) {
          await mountResult;
        }
        
        await options.customAssertions(module, testContainer);
        addTest('Custom assertions pass', true);
      } catch (error) {
        addTest('Custom assertions pass', false, String(error));
      } finally {
        document.body.removeChild(testContainer);
      }
    }
    
  } catch (error) {
    addTest('Unexpected error', false, String(error));
  }
  
  const passed = tests.every(t => t.passed);
  return { passed, tests, duration: Date.now() - startTime };
}

// ============================================
// Jest/Vitest Integration
// ============================================

/**
 * Create test suite for plugin contract verification
 * 
 * For use with Jest or Vitest test runners.
 * 
 * @param getModule - Function that returns the plugin module
 * @param options - Test options
 * 
 * @example
 * ```typescript
 * import { describe } from 'vitest';
 * import { testPluginContract } from '@naap/plugin-sdk/testing';
 * 
 * describe('MyPlugin', () => {
 *   testPluginContract(() => import('../src/App'));
 * });
 * ```
 */
export function testPluginContract(
  getModule: () => Promise<{ default?: PluginModule } | PluginModule>,
  options: ContractTestOptions = {}
): void {
  // These will be provided by the test runner (Jest/Vitest)
  const { describe, it, expect, beforeAll, afterAll } = globalThis as any;
  
  if (!describe || !it || !expect) {
    console.error('testPluginContract requires Jest or Vitest test runner');
    return;
  }
  
  describe('Plugin Contract Tests', () => {
    let module: PluginModule;
    let loadError: Error | null = null;
    
    beforeAll(async () => {
      try {
        const imported = await getModule();
        module = 'default' in imported ? (imported.default as PluginModule) : imported as PluginModule;
      } catch (error) {
        loadError = error as Error;
      }
    });
    
    it('should load module successfully', () => {
      expect(loadError).toBeNull();
      expect(module).toBeDefined();
    });
    
    it('should export mount() function', () => {
      expect(typeof module.mount).toBe('function');
    });
    
    it('should mount without error', async () => {
      const container = document.createElement('div');
      const context = options.shellContext || createMockShellContext();
      
      let error: Error | null = null;
      try {
        const result = module.mount(container, context);
        if (result instanceof Promise) {
          await result;
        }
      } catch (e) {
        error = e as Error;
      }
      
      expect(error).toBeNull();
    });
    
    it('should return valid unmount function or void', async () => {
      const container = document.createElement('div');
      const context = options.shellContext || createMockShellContext();
      
      const result = module.mount(container, context);
      const unmount = result instanceof Promise ? await result : result;
      
      expect(unmount === undefined || typeof unmount === 'function').toBe(true);
      
      if (typeof unmount === 'function') {
        expect(() => unmount()).not.toThrow();
      }
    });
    
    it('should have valid optional exports', () => {
      if (module.init !== undefined) {
        expect(typeof module.init).toBe('function');
      }
      
      if (module.cleanup !== undefined) {
        expect(typeof module.cleanup).toBe('function');
      }
      
      if (module.metadata !== undefined) {
        expect(typeof module.metadata).toBe('object');
      }
    });
  });
}

// ============================================
// Assertion Helpers
// ============================================

/**
 * Common assertion helpers for custom contract tests
 */
export const assertions = {
  /**
   * Assert that mount renders content
   */
  rendersContent: (container: HTMLElement) => {
    if (container.innerHTML.trim() === '') {
      throw new Error('Plugin did not render any content');
    }
  },
  
  /**
   * Assert that mount renders specific element
   */
  rendersElement: (container: HTMLElement, selector: string) => {
    if (!container.querySelector(selector)) {
      throw new Error(`Plugin did not render element matching "${selector}"`);
    }
  },
  
  /**
   * Assert that no console errors occurred
   */
  noConsoleErrors: (() => {
    const errors: string[] = [];
    const originalError = console.error;
    
    return {
      start: () => {
        console.error = (...args) => {
          errors.push(args.map(String).join(' '));
          originalError.apply(console, args);
        };
      },
      stop: () => {
        console.error = originalError;
      },
      assert: () => {
        if (errors.length > 0) {
          throw new Error(`Console errors occurred: ${errors.join('; ')}`);
        }
      },
    };
  })(),
};
