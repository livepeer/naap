/**
 * Vite Configuration for Developer API Plugin
 */
import { createPluginConfig } from '@naap/plugin-build/vite';

export default createPluginConfig({
  name: 'developer-api',
  displayName: 'Developer API',
  globalName: 'NaapPluginDeveloperApi',
  defaultCategory: 'developer',
});
