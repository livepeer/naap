import { useShell } from './useShell.js';

export interface KeyboardShortcut {
  pluginName: string;
  key: string;
  modifiers: ('ctrl' | 'alt' | 'shift' | 'meta')[];
  action: string;
  description: string;
}

/**
 * Hook for registering keyboard shortcuts
 * 
 * Allows plugins to register global keyboard shortcuts that trigger
 * custom events via the event bus.
 * 
 * @example
 * ```tsx
 * function MyPlugin() {
 *   const { registerShortcut, unregisterShortcut } = useKeyboardShortcut();
 *   
 *   useEffect(() => {
 *     registerShortcut({
 *       key: 'd',
 *       modifiers: ['ctrl'],
 *       action: 'my-plugin:debug',
 *       description: 'Open debug panel'
 *     });
 *   }, []);
 *   
 *   // Listen for the action
 *   useEffect(() => {
 *     const handler = () => console.log('Shortcut triggered!');
 *     shell.eventBus.on('my-plugin:debug', handler);
 *     return () => shell.eventBus.off('my-plugin:debug', handler);
 *   }, []);
 * }
 * ```
 */
export function useKeyboardShortcut(pluginName: string) {
  const shell = useShell();

  const registerShortcut = (shortcut: Omit<KeyboardShortcut, 'pluginName'>) => {
    shell.eventBus.emit('shell:register-shortcut', {
      ...shortcut,
      pluginName
    });
  };

  const unregisterShortcut = (key: string, modifiers: string[]) => {
    shell.eventBus.emit('shell:unregister-shortcut', {
      pluginName,
      key,
      modifiers
    });
  };

  return {
    registerShortcut,
    unregisterShortcut
  };
}
