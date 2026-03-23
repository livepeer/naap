/**
 * Vite Configuration for AgentBook Expense Plugin
 */
import { createPluginConfig } from '@naap/plugin-build/vite';

export default createPluginConfig({
  name: 'agentbook-expense',
  displayName: 'AgentBook Expenses',
  globalName: 'NaapPluginAgentbookExpense',
  defaultCategory: 'finance',
});
