/**
 * Vite Configuration for Gateway Manager Plugin
 */
import { createPluginConfig } from '@naap/plugin-build/vite';

export default createPluginConfig({
  name: 'gateway-manager',
  displayName: 'Gateway Manager',
  globalName: 'NaapPluginGatewayManager',
  defaultCategory: 'infrastructure',
});
