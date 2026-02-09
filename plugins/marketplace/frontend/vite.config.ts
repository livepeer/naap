/**
 * Vite Configuration for Marketplace Plugin
 */
import { createPluginConfig } from '@naap/plugin-build/vite';

export default createPluginConfig({
  name: 'marketplace',
  displayName: 'Plugin Marketplace',
  globalName: 'NaapPluginMarketplace',
  defaultCategory: 'platform',
});
