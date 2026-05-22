/**
 * Vite Configuration for Developer API Plugin
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv, mergeConfig, type ConfigEnv, type UserConfig } from 'vite';
import { createPluginConfig } from '@naap/plugin-build/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const basePluginConfig = createPluginConfig({
  name: 'developer-api',
  displayName: 'Developer API',
  globalName: 'NaapPluginDeveloperApi',
  defaultCategory: 'developer',
});

function loadPmthouseBaseUrl(mode: string): string {
  const roots = [
    path.resolve(__dirname, '../../../apps/web-next'),
    path.resolve(__dirname, '../../..'),
    __dirname,
  ];
  for (const root of roots) {
    const loaded = loadEnv(mode, root, '');
    const value = loaded.PMTHOUSE_BASE_URL?.trim();
    if (value) {
      return value;
    }
  }
  return process.env.PMTHOUSE_BASE_URL?.trim() || '';
}

export default defineConfig((configEnv: ConfigEnv) => {
  const base = (
    typeof basePluginConfig === 'function'
      ? (basePluginConfig as (env: ConfigEnv) => UserConfig)(configEnv)
      : basePluginConfig
  ) as UserConfig;
  const pmthouseBaseUrl = loadPmthouseBaseUrl(configEnv.mode);
  return mergeConfig(base, {
    define: {
      'import.meta.env.PMTHOUSE_BASE_URL': JSON.stringify(pmthouseBaseUrl),
    },
  });
});
