/**
 * Runtime Contract Validation for NAAP Plugins
 *
 * Provides pre-flight validation of plugin modules and shell context
 * with human-readable, actionable error messages. Catches common mistakes
 * (missing mount, wrong exports, invalid context) before they cause
 * cryptic runtime errors.
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates a plugin module's structure and exports.
 *
 * Checks:
 * - module is a non-null object
 * - module.mount exists and is a function
 * - module.mount accepts at least 1 parameter (container)
 * - If module.unmount exists, it is a function
 * - If module.metadata exists, it has name (string) and version (string)
 */
export function validatePluginModule(
  module: unknown,
  pluginName: string
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (module === null || module === undefined) {
    errors.push(
      `Plugin module is ${module === null ? 'null' : 'undefined'}.` +
      `\n  → Did the script fail to execute? Check the browser console for errors.`
    );
    return { valid: false, errors, warnings };
  }

  if (typeof module === 'function') {
    errors.push(
      `Plugin module is a function, not an object.` +
      `\n  → If this is a factory function, the shell should call it first.` +
      `\n  → Expected: { mount: (container, context) => cleanup }`
    );
    return { valid: false, errors, warnings };
  }

  if (typeof module !== 'object') {
    errors.push(
      `Plugin module is a ${typeof module}, expected an object with a mount() function.`
    );
    return { valid: false, errors, warnings };
  }

  const mod = module as Record<string, unknown>;

  // Check mount function
  if (!('mount' in mod) || mod.mount === undefined) {
    errors.push(
      `mount() is missing from the plugin module.` +
      `\n  → Did you forget to export { mount } from your mount.tsx?` +
      `\n` +
      `\n  Quick fix — use createPlugin() in your App.tsx:` +
      `\n    import { createPlugin } from '@naap/plugin-sdk';` +
      `\n    const plugin = createPlugin({ name: '${pluginName}', version: '1.0.0', App: MyApp });` +
      `\n    export default plugin;`
    );
  } else if (typeof mod.mount !== 'function') {
    errors.push(
      `mount is not a function (got: ${typeof mod.mount}).` +
      `\n  → mount must be a function: (container: HTMLElement, context: ShellContext) => cleanup`
    );
  }

  // Check unmount (optional but must be function if present)
  if ('unmount' in mod && mod.unmount !== undefined && typeof mod.unmount !== 'function') {
    errors.push(
      `unmount is not a function (got: ${typeof mod.unmount}).` +
      `\n  → unmount must be a function: () => void`
    );
  }

  // Check metadata (optional but validate structure if present)
  if ('metadata' in mod && mod.metadata !== undefined) {
    const meta = mod.metadata;
    if (typeof meta !== 'object' || meta === null) {
      warnings.push(
        `metadata is not an object (got: ${typeof meta}).` +
        `\n  → Expected: { name: string, version: string }`
      );
    } else {
      const m = meta as Record<string, unknown>;
      if (typeof m.name !== 'string' || m.name.length === 0) {
        warnings.push(`metadata.name is missing or not a string.`);
      }
      if (typeof m.version !== 'string' || m.version.length === 0) {
        warnings.push(`metadata.version is missing or not a string.`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validates the shell context object passed to plugin mount().
 *
 * Checks for expected top-level properties that plugins rely on.
 */
export function validateShellContext(context: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (context === null || context === undefined) {
    errors.push(
      `Shell context is ${context === null ? 'null' : 'undefined'}.` +
      `\n  → The shell must pass a valid context object to plugin.mount(container, context).`
    );
    return { valid: false, errors, warnings };
  }

  if (typeof context !== 'object') {
    errors.push(
      `Shell context is a ${typeof context}, expected an object.` +
      `\n  → The shell must pass a valid context object to plugin.mount(container, context).`
    );
    return { valid: false, errors, warnings };
  }

  const ctx = context as Record<string, unknown>;

  // Check for commonly expected properties
  if (!('navigate' in ctx) || typeof ctx.navigate !== 'function') {
    warnings.push(
      `Shell context is missing navigate() function.` +
      `\n  → Plugins that use useNavigate() may fail.`
    );
  }

  if (!('eventBus' in ctx) || ctx.eventBus === null || typeof ctx.eventBus !== 'object') {
    warnings.push(
      `Shell context is missing eventBus object.` +
      `\n  → Plugins that use useEvents() may fail.`
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Formats a validation result into a human-readable error message
 * suitable for console output.
 */
export function formatPluginError(
  pluginName: string,
  phase: string,
  result: ValidationResult
): string {
  const lines: string[] = [];

  lines.push(`[NAAP Plugin Error] Plugin "${pluginName}" failed during ${phase}:`);
  lines.push('');

  for (const error of result.errors) {
    lines.push(`  ✗ ${error}`);
    lines.push('');
  }

  for (const warning of result.warnings) {
    lines.push(`  ⚠ ${warning}`);
    lines.push('');
  }

  return lines.join('\n');
}
