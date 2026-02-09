/**
 * Vite Configuration for Plugin Publisher
 */
import { createPluginConfig } from '@naap/plugin-build/vite';

export default createPluginConfig({
  name: 'plugin-publisher',
  displayName: 'Plugin Publisher',
  globalName: 'NaapPluginPluginPublisher',
  defaultCategory: 'developer',
});
