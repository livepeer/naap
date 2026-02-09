import { useShell } from './useShell.js';
import type { ReactNode } from 'react';

export interface OverlayOptions {
  id: string;
  position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
  size?: { width?: number; height?: number };
  backdrop?: boolean;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
}

export interface Overlay {
  id: string;
  content: ReactNode;
  options: OverlayOptions;
}

/**
 * Hook for managing plugin overlays
 * 
 * Allows plugins to render UI elements as global overlays that
 * appear above the main content. Useful for modals, notifications,
 * or floating panels that need to escape the plugin's container.
 * 
 * @example
 * ```tsx
 * function MyPlugin() {
 *   const { showOverlay, hideOverlay } = useOverlay();
 *   
 *   const openModal = () => {
 *     showOverlay(
 *       <MyModalContent />,
 *       {
 *         id: 'my-modal',
 *         position: 'center',
 *         backdrop: true,
 *         closeOnBackdrop: true
 *       }
 *     );
 *   };
 *   
 *   return <button onClick={openModal}>Open</button>;
 * }
 * ```
 */
export function useOverlay() {
  const shell = useShell();

  /**
   * Show an overlay
   */
  const showOverlay = (content: ReactNode, options: OverlayOptions) => {
    shell.eventBus.emit('shell:overlay:show', {
      content,
      options: {
        backdrop: true,
        closeOnBackdrop: true,
        closeOnEscape: true,
        position: 'center',
        ...options
      }
    });
  };

  /**
   * Hide an overlay by ID
   */
  const hideOverlay = (id: string) => {
    shell.eventBus.emit('shell:overlay:hide', { id });
  };

  /**
   * Hide all overlays
   */
  const hideAllOverlays = () => {
    shell.eventBus.emit('shell:overlay:hide-all');
  };

  /**
   * Update overlay options
   */
  const updateOverlay = (id: string, options: Partial<OverlayOptions>) => {
    shell.eventBus.emit('shell:overlay:update', { id, options });
  };

  return {
    showOverlay,
    hideOverlay,
    hideAllOverlays,
    updateOverlay
  };
}
