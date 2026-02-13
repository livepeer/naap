/**
 * Vite Configuration for Orchestrator Manager Plugin
 */
import { createPluginConfig } from '@naap/plugin-build/vite';

export default createPluginConfig({
  name: 'orchestrator-manager',
  displayName: 'Orchestrator Manager',
  globalName: 'NaapPluginOrchestratorManager',
  defaultCategory: 'infrastructure',
});
