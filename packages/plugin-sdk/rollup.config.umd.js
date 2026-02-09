/**
 * Rollup Configuration for UMD Build
 *
 * This configuration produces a UMD bundle that can be loaded via script tag.
 * The bundle exposes the SDK as window.NaapPluginSDK
 *
 * External dependencies (React, ReactDOM) are NOT bundled to avoid version conflicts.
 * They are expected to be provided by the host application.
 */

import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Main UMD bundle configuration
 */
const umdConfig = {
  input: 'src/umd/index.ts',
  output: [
    {
      file: 'dist/umd/naap-plugin-sdk.js',
      format: 'umd',
      name: 'NaapPluginSDK',
      globals: {
        react: 'React',
        'react-dom': 'ReactDOM',
        'react-dom/client': 'ReactDOM',
      },
      sourcemap: true,
      banner: `/**
 * @naap/plugin-sdk UMD Bundle
 * Version: ${process.env.npm_package_version || '0.1.0'}
 * Build: ${new Date().toISOString()}
 * 
 * This bundle is designed for loading plugins via script tag.
 * React and ReactDOM must be available globally.
 */`,
    },
    // Minified version for production
    {
      file: 'dist/umd/naap-plugin-sdk.min.js',
      format: 'umd',
      name: 'NaapPluginSDK',
      globals: {
        react: 'React',
        'react-dom': 'ReactDOM',
        'react-dom/client': 'ReactDOM',
      },
      sourcemap: true,
      plugins: [
        terser({
          compress: {
            pure_getters: true,
            unsafe: true,
            unsafe_comps: true,
          },
          format: {
            comments: /^!/,
          },
        }),
      ],
    },
  ],
  external: ['react', 'react-dom', 'react-dom/client'],
  plugins: [
    resolve({
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
    }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.json',
      declaration: true,
      declarationDir: './dist/umd',
      outDir: './dist/umd',
      sourceMap: true,
      include: ['src/umd/**/*.ts', 'src/types/**/*.ts'],
      compilerOptions: {
        // Override some options for UMD build
        module: 'ESNext',
        moduleResolution: 'bundler',
        declaration: true,
        declarationMap: true,
        noEmit: false,
        composite: false,
      },
    }),
  ],
  onwarn(warning, warn) {
    // Ignore certain warnings
    if (warning.code === 'THIS_IS_UNDEFINED') return;
    if (warning.code === 'CIRCULAR_DEPENDENCY') {
      // Only warn about circular deps in non-prod
      if (!isProduction) warn(warning);
      return;
    }
    warn(warning);
  },
};

export default [umdConfig];
