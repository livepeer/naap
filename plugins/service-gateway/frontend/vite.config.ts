/**
 * Vite Configuration for Service Gateway Plugin
 */
import { createPluginConfig } from '@naap/plugin-build/vite';

export default createPluginConfig({
  name: 'service-gateway',
  displayName: 'Service Gateway',
  globalName: 'NaapPluginServiceGateway',
  defaultCategory: 'platform',
});
