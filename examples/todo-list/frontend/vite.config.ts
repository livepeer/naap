/**
 * Vite Configuration for Todo List Example Plugin
 */
import { createPluginConfig } from '@naap/plugin-build/vite';

export default createPluginConfig({
  name: 'todo-list',
  displayName: 'Todo List',
  globalName: 'NaapPluginTodoList',
});
