import plugin from './App';

const PLUGIN_GLOBAL_NAME = 'NaapPluginAgentbookCore';

export const mount = plugin.mount;
export const unmount = plugin.unmount;
export const getContext = (plugin as any).getContext;
export const metadata = (plugin as any).metadata || { name: 'agentbook-core', version: '1.0.0' };

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>)[PLUGIN_GLOBAL_NAME] = {
    mount, unmount, getContext, metadata,
  };
}

export default { mount, unmount, getContext, metadata };
