/**
 * Vite Configuration for Community Plugin
 */
import { createPluginConfig } from '@naap/plugin-build/vite';

export default createPluginConfig({
  name: 'community',
  displayName: 'Community Hub',
  globalName: 'NaapPluginCommunity',
  defaultCategory: 'social',
});
