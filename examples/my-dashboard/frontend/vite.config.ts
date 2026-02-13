/**
 * Vite Configuration for My Dashboard Plugin
 */
import { createPluginConfig } from '@naap/plugin-build/vite';

export default createPluginConfig({
  name: 'my-dashboard',
  displayName: 'My Dashboard',
  globalName: 'NaapPluginMyDashboard',
  defaultCategory: 'analytics',
});
