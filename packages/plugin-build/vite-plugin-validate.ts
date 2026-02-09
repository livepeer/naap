/**
 * Vite Plugin: NAAP UMD Bundle Validator
 *
 * Validates plugin bundles after build to catch React version conflicts.
 * Add this plugin to any UMD build config to ensure bundles won't break
 * when loaded in the shell.
 *
 * Usage:
 * ```typescript
 * import { naapBundleValidator } from '@naap/plugin-build/vite-plugin-validate';
 *
 * export default defineConfig({
 *   plugins: [
 *     react(),
 *     naapBundleValidator({ pluginName: 'my-plugin' }),
 *   ],
 *   // ...
 * });
 * ```
 */

import type { Plugin } from 'vite';
import { readFileSync, readdirSync, existsSync } from 'fs';

export interface ValidatorOptions {
  /** Plugin name for error messages */
  pluginName: string;

  /** Output directory (default: 'dist/production') */
  outDir?: string;

  /** Fail build on validation error (default: true) */
  failOnError?: boolean;
}

/**
 * Forbidden patterns that indicate bundled React internals.
 */
const FORBIDDEN_PATTERNS = [
  '__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED',
  'react-jsx-runtime.production',
  'react-jsx-runtime.development',
  'react-jsx-dev-runtime.production',
  'react-jsx-dev-runtime.development',
];

/**
 * Creates a Vite plugin that validates UMD bundles after build.
 */
export function naapBundleValidator(options: ValidatorOptions): Plugin {
  const {
    pluginName,
    outDir = 'dist/production',
    failOnError = true,
  } = options;

  return {
    name: 'naap-bundle-validator',
    enforce: 'post',

    closeBundle() {
      if (!existsSync(outDir)) {
        console.warn(`[naap-validator] Output directory not found: ${outDir}`);
        return;
      }

      const files = readdirSync(outDir);
      const bundleFile = files.find((f: string) => f.endsWith('.js') && !f.endsWith('.map'));

      if (!bundleFile) {
        console.warn(`[naap-validator] No JS bundle found in ${outDir}`);
        return;
      }

      const bundlePath = `${outDir}/${bundleFile}`;
      const content = readFileSync(bundlePath, 'utf-8');
      const errors: string[] = [];

      // Check for bundled React internals
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (content.includes(pattern)) {
          errors.push(
            `Contains bundled React internals: "${pattern}"\n` +
            `     This causes plugins to fail with different React versions.\n` +
            `     Fix: Add 'react/jsx-runtime' to rollupOptions.external`
          );
        }
      }

      // Check UMD format
      const firstLine = content.split('\n')[0];
      if (!firstLine.includes('globalThis') && !firstLine.includes('self')) {
        errors.push(`Missing UMD wrapper - ensure formats: ['umd'] in build.lib`);
      }

      // Check React external
      if (!firstLine.includes('.React')) {
        errors.push(`React may not be externalized - check rollupOptions.external`);
      }

      // Report results
      const bundleSize = Buffer.byteLength(content, 'utf-8');
      console.log(`\n🔍 Validating ${pluginName} bundle (${(bundleSize / 1024).toFixed(1)} KB)`);

      if (errors.length > 0) {
        console.error(`\n❌ VALIDATION FAILED:\n`);
        errors.forEach((err, i) => {
          console.error(`   ${i + 1}. ${err}\n`);
        });

        if (failOnError) {
          throw new Error(`Plugin validation failed with ${errors.length} error(s)`);
        }
      } else {
        console.log(`✅ No bundled React internals - plugin is compatible`);
      }
    },
  };
}

export default naapBundleValidator;
