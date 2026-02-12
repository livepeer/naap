/**
 * Vite Configuration for Daydream Video Plugin
 */
import { createPluginConfig } from '@naap/plugin-build/vite';

export default createPluginConfig({
  name: 'daydream-video',
  displayName: 'Daydream Video',
  globalName: 'NaapPluginDaydreamVideo',
  defaultCategory: 'ai',
});
