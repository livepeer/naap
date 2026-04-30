/**
 * Vite Configuration for AgentBook Invoice Plugin
 */
import { createPluginConfig } from '@naap/plugin-build/vite';

export default createPluginConfig({
  name: 'agentbook-invoice',
  displayName: 'AgentBook Invoicing',
  globalName: 'NaapPluginAgentbookInvoice',
  defaultCategory: 'finance',
});
