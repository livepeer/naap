/**
 * Plugin Lifecycle Hook Executor
 * 
 * Executes plugin-defined lifecycle hooks safely:
 * - postInstall: After plugin installation completes
 * - preUpdate: Before plugin upgrade starts
 * - postUpdate: After plugin upgrade completes  
 * - preUninstall: Before plugin uninstallation starts
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Hook execution context
 */
export interface HookContext {
  pluginName: string;
  version: string;
  action: 'install' | 'update' | 'uninstall';
  environment: Record<string, string>;
}

/**
 * Hook execution result
 */
export interface HookExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  exitCode?: number;
  duration: number;
}

/**
 * Hook configuration from plugin manifest
 */
export interface PluginHooks {
  postInstall?: string;
  preUpdate?: string;
  postUpdate?: string;
  preUninstall?: string;
}

/**
 * Hook executor configuration
 */
export interface HookExecutorConfig {
  /** Timeout in milliseconds (default: 300000 = 5 minutes) */
  timeout?: number;
  /** Working directory for hook execution */
  workingDir?: string;
  /** Whether to continue on hook failure (default: false) */
  continueOnError?: boolean;
}

/**
 * Execute a lifecycle hook script
 * 
 * @param hookScript - The hook script command to execute
 * @param context - Execution context with plugin info and environment
 * @param config - Execution configuration
 * @returns Execution result with output and status
 */
export async function executeHook(
  hookScript: string,
  context: HookContext,
  config: HookExecutorConfig = {}
): Promise<HookExecutionResult> {
  const {
    timeout = 300000, // 5 minutes default
    workingDir = process.cwd(),
    continueOnError = false,
  } = config;

  const startTime = Date.now();

  // Validate hook script (basic security check)
  if (!hookScript || typeof hookScript !== 'string') {
    return {
      success: false,
      error: 'Invalid hook script provided',
      duration: Date.now() - startTime,
    };
  }

  // Sanitize hook script - prevent command injection
  const sanitizedScript = hookScript.trim();
  if (sanitizedScript.includes('&&') || sanitizedScript.includes('||') || sanitizedScript.includes(';')) {
    return {
      success: false,
      error: 'Hook scripts cannot contain chained commands (&&, ||, ;)',
      duration: Date.now() - startTime,
    };
  }

  console.log(`[HookExecutor] Executing ${context.action} hook for ${context.pluginName}@${context.version}`);
  console.log(`[HookExecutor] Command: ${sanitizedScript}`);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // Parse command and args
    const parts = sanitizedScript.split(' ');
    const command = parts[0];
    const args = parts.slice(1);

    // Prepare environment variables
    const env = {
      ...process.env,
      ...context.environment,
      PLUGIN_NAME: context.pluginName,
      PLUGIN_VERSION: context.version,
      LIFECYCLE_ACTION: context.action,
    };

    // Spawn the process
    const child = spawn(command, args, {
      cwd: workingDir,
      env,
      shell: false, // Don't use shell for security
      timeout,
    });

    // Set timeout
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      
      // Force kill after 5 seconds
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5000);
    }, timeout);

    // Capture output
    child.stdout?.on('data', (data) => {
      const output = data.toString();
      stdout += output;
      console.log(`[HookExecutor stdout] ${output.trim()}`);
    });

    child.stderr?.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      console.error(`[HookExecutor stderr] ${output.trim()}`);
    });

    // Handle completion
    child.on('close', (code) => {
      clearTimeout(timeoutHandle);
      const duration = Date.now() - startTime;

      if (timedOut) {
        console.error(`[HookExecutor] Hook timed out after ${timeout}ms`);
        resolve({
          success: continueOnError,
          error: `Hook execution timed out after ${timeout}ms`,
          output: stdout,
          exitCode: -1,
          duration,
        });
        return;
      }

      const success = code === 0;
      
      if (success) {
        console.log(`[HookExecutor] Hook completed successfully in ${duration}ms`);
      } else {
        console.error(`[HookExecutor] Hook failed with exit code ${code}`);
      }

      resolve({
        success: success || continueOnError,
        output: stdout,
        error: success ? undefined : (stderr || `Exit code: ${code}`),
        exitCode: code || 0,
        duration,
      });
    });

    // Handle errors
    child.on('error', (err) => {
      clearTimeout(timeoutHandle);
      const duration = Date.now() - startTime;
      
      console.error(`[HookExecutor] Hook execution error:`, err);
      
      resolve({
        success: continueOnError,
        error: err.message,
        output: stdout,
        duration,
      });
    });
  });
}

/**
 * Execute multiple hooks in sequence
 * 
 * @param hooks - Array of hook scripts to execute
 * @param context - Execution context
 * @param config - Execution configuration
 * @returns Array of execution results
 */
export async function executeHooksSequentially(
  hooks: string[],
  context: HookContext,
  config: HookExecutorConfig = {}
): Promise<HookExecutionResult[]> {
  const results: HookExecutionResult[] = [];

  for (const hook of hooks) {
    const result = await executeHook(hook, context, config);
    results.push(result);

    // Stop on first failure unless continueOnError is true
    if (!result.success && !config.continueOnError) {
      console.error(`[HookExecutor] Stopping hook execution after failure`);
      break;
    }
  }

  return results;
}

/**
 * Execute plugin lifecycle hooks based on manifest
 * 
 * @param manifest - Plugin manifest with hook definitions
 * @param hookType - Type of hook to execute
 * @param context - Execution context
 * @param config - Execution configuration
 * @returns Execution result
 */
export async function executeLifecycleHook(
  manifest: PluginHooks | null,
  hookType: keyof PluginHooks,
  context: HookContext,
  config: HookExecutorConfig = {}
): Promise<HookExecutionResult | null> {
  if (!manifest || !manifest[hookType]) {
    console.log(`[HookExecutor] No ${hookType} hook defined for ${context.pluginName}`);
    return null;
  }

  const hookScript = manifest[hookType]!;
  
  console.log(`[HookExecutor] Executing ${hookType} hook for ${context.pluginName}`);
  
  return executeHook(hookScript, context, config);
}

/**
 * Validate hook scripts in plugin manifest
 * Returns array of validation errors, empty if valid
 * 
 * @param hooks - Hook definitions to validate
 * @returns Array of validation error messages
 */
export function validateHooks(hooks: PluginHooks): string[] {
  const errors: string[] = [];
  const allowedHooks: Array<keyof PluginHooks> = ['postInstall', 'preUpdate', 'postUpdate', 'preUninstall'];

  for (const key of Object.keys(hooks)) {
    if (!allowedHooks.includes(key as keyof PluginHooks)) {
      errors.push(`Unknown hook type: ${key}`);
      continue;
    }

    const hookScript = hooks[key as keyof PluginHooks];
    
    if (typeof hookScript !== 'string') {
      errors.push(`Hook ${key} must be a string command`);
      continue;
    }

    if (hookScript.trim().length === 0) {
      errors.push(`Hook ${key} cannot be empty`);
      continue;
    }

    // Check for potentially dangerous patterns
    if (hookScript.includes('&&') || hookScript.includes('||') || hookScript.includes(';')) {
      errors.push(`Hook ${key} contains chained commands which are not allowed`);
    }

    if (hookScript.includes('rm -rf /') || hookScript.includes(':(){ :|:& };:')) {
      errors.push(`Hook ${key} contains dangerous commands`);
    }
  }

  return errors;
}

/**
 * Load hooks from plugin manifest file
 * 
 * @param manifestPath - Path to plugin manifest file
 * @returns Plugin hooks or null if not found/invalid
 */
export async function loadHooksFromManifest(manifestPath: string): Promise<PluginHooks | null> {
  try {
    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestContent);
    
    if (manifest.hooks && typeof manifest.hooks === 'object') {
      // Validate hooks before returning
      const errors = validateHooks(manifest.hooks);
      if (errors.length > 0) {
        console.error(`[HookExecutor] Invalid hooks in manifest:`, errors);
        return null;
      }
      
      return manifest.hooks;
    }
    
    return null;
  } catch (error) {
    console.error(`[HookExecutor] Failed to load manifest from ${manifestPath}:`, error);
    return null;
  }
}
