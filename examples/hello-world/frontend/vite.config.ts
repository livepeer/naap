/**
 * Vite Configuration for Hello World Example Plugin
 */
import { createPluginConfig } from '@naap/plugin-build/vite';

export default createPluginConfig({
  name: 'hello-world',
  displayName: 'Hello World',
  globalName: 'NaapPluginHelloWorld',
});
