/**
 * Vite Configuration for Dashboard Provider Mock Plugin
 */
import { createPluginConfig } from '@naap/plugin-build/vite';

export default createPluginConfig({
  name: 'dashboard-provider-mock',
  displayName: 'Dashboard Provider (Mock)',
  globalName: 'NaapPluginDashboardProviderMock',
  defaultCategory: 'analytics',
});
