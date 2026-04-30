/**
 * Vite Configuration for AgentBook Tax & Reports Plugin
 */
import { createPluginConfig } from '@naap/plugin-build/vite';

export default createPluginConfig({
  name: 'agentbook-tax',
  displayName: 'AgentBook Tax & Reports',
  globalName: 'NaapPluginAgentbookTax',
  defaultCategory: 'finance',
});
