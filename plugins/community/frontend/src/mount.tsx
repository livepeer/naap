/**
 * UMD Mount Entry for Community Plugin
 *
 * This is the entry point for the UMD/CDN build.
 * It delegates to the plugin instance from App.tsx, ensuring the same
 * routes, auth sync, and SDK hooks are available in production.
 *
 * Why this matters:
 * - The shell loads UMD plugins and calls mount(container, shellContext)
 * - createPlugin() wraps the App with ShellProvider from the SDK
 * - This means SDK hooks (useUser, useAuth, useTeam, etc.) work correctly
 * - Without ShellProvider, SDK hooks throw "must be used within ShellProvider"
 */

import plugin from './App';

const PLUGIN_GLOBAL_NAME = 'NaapPluginCommunity';

// Re-export plugin lifecycle functions
export const mount = plugin.mount;
export const unmount = plugin.unmount;
export const getContext = (plugin as any).getContext;
export const metadata = (plugin as any).metadata || { name: 'community', version: '1.2.0' };

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
