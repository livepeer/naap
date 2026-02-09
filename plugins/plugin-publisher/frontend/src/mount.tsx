/**
 * UMD Mount Entry for Plugin Publisher Plugin
 *
 * Delegates to the plugin instance from App.tsx for consistent
 * routing, auth, and SDK hook support in CDN/UMD mode.
 */

import plugin from './App';

const PLUGIN_GLOBAL_NAME = 'NaapPluginPluginPublisher';

export const mount = plugin.mount;
export const unmount = (plugin as any).unmount;
export const getContext = (plugin as any).getContext;
export const metadata = (plugin as any).metadata || { name: 'pluginPublisher', version: '1.0.0' };

// UMD Global Registration
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>)[PLUGIN_GLOBAL_NAME] = {
    mount,
    unmount,
    getContext,
    metadata,
  };
}

export default { mount, unmount, getContext, metadata };
