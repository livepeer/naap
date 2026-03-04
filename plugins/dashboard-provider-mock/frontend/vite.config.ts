/**
 * Vite Configuration for Dashboard Provider Plugin
 */
import { createPluginConfig } from '@naap/plugin-build/vite';

export default createPluginConfig({
  name: 'dashboard-provider-mock',
  displayName: 'Dashboard Provider',
  globalName: 'NaapPluginDashboardProviderMock',
  defaultCategory: 'analytics',
});
