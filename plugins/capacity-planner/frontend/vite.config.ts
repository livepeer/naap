/**
 * Vite Configuration for Capacity Planner Plugin
 */
import { createPluginConfig } from '@naap/plugin-build/vite';

export default createPluginConfig({
  name: 'capacity-planner',
  displayName: 'Capacity Planner',
  globalName: 'NaapPluginCapacityPlanner',
  defaultCategory: 'infrastructure',
});
