/**
 * UMD Mount Entry for Dashboard Data Provider Plugin
 */

import plugin from './App.js';

const PLUGIN_GLOBAL_NAME = 'NaapPluginDashboardDataProvider';

export const mount = plugin.mount;
export const unmount = (plugin as any).unmount;
export const metadata = (plugin as any).metadata || {
  name: 'dashboard-data-provider',
  version: '1.0.0',
};

// UMD Global Registration
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>)[PLUGIN_GLOBAL_NAME] = {
    mount,
    unmount,
    metadata,
  };
}

export default { mount, unmount, metadata };
