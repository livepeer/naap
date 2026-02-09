/**
 * Vite Configuration for Network Analytics Plugin
 */
import { createPluginConfig } from '@naap/plugin-build/vite';

export default createPluginConfig({
  name: 'network-analytics',
  displayName: 'Network Analytics',
  globalName: 'NaapPluginNetworkAnalytics',
  defaultCategory: 'analytics',
});
