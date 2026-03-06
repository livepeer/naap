/**
 * Vite Configuration for Dashboard Data Provider Plugin
 */
import { createPluginConfig } from '@naap/plugin-build/vite';

export default createPluginConfig({
  name: 'dashboard-data-provider',
  displayName: 'Dashboard Data Provider',
  globalName: 'NaapPluginDashboardDataProvider',
  defaultCategory: 'analytics',
});
