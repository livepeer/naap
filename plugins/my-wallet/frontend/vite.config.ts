/**
 * Vite Configuration for My Wallet Plugin
 */
import { createPluginConfig } from '@naap/plugin-build/vite';

export default createPluginConfig({
  name: 'my-wallet',
  displayName: 'My Wallet',
  globalName: 'NaapPluginMyWallet',
  defaultCategory: 'finance',
});
