/**
 * Theme utilities for plugins
 *
 * These utilities help plugins observe and respond to theme changes
 * from the shell without requiring a full re-render.
 */

export type ThemeMode = 'light' | 'dark';

/**
 * Get the current theme mode by checking if the document has the 'dark' class
 */
export function getCurrentTheme(): ThemeMode {
  if (typeof document === 'undefined') {
    return 'dark'; // SSR default
  }
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/**
 * Check if the current theme is dark mode
 */
export function isDarkMode(): boolean {
  return getCurrentTheme() === 'dark';
}

/**
 * Check if the current theme is light mode
 */
export function isLightMode(): boolean {
  return getCurrentTheme() === 'light';
}

/**
 * Observe theme changes on the document element
 *
 * Uses MutationObserver to watch for class changes on <html>.
 * When the shell toggles the 'dark' class, the handler is called.
 *
 * @param handler - Callback function that receives the new theme mode
 * @returns Cleanup function to stop observing
 *
 * @example
 * ```ts
 * // In a React component
 * useEffect(() => {
 *   return observeThemeChanges((mode) => {
 *     console.log('Theme changed to:', mode);
 *   });
 * }, []);
 * ```
 */
export function observeThemeChanges(
  handler: (mode: ThemeMode) => void
): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => {};
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.attributeName === 'class') {
        const isDark = document.documentElement.classList.contains('dark');
        handler(isDark ? 'dark' : 'light');
        break;
      }
    }
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });

  // Call handler immediately with current theme
  handler(getCurrentTheme());

  return () => observer.disconnect();
}

/**
 * Apply theme-specific styles to an element
 *
 * @param element - The element to style
 * @param lightStyles - Styles to apply in light mode
 * @param darkStyles - Styles to apply in dark mode
 */
export function applyThemeStyles(
  element: HTMLElement,
  lightStyles: Partial<CSSStyleDeclaration>,
  darkStyles: Partial<CSSStyleDeclaration>
): () => void {
  const applyStyles = (mode: ThemeMode) => {
    const styles = mode === 'dark' ? darkStyles : lightStyles;
    Object.assign(element.style, styles);
  };

  return observeThemeChanges(applyStyles);
}

/**
 * Get theme-aware color value
 *
 * Returns the appropriate color based on current theme.
 * Useful for JavaScript-driven styling (e.g., charts, canvas).
 *
 * @param lightValue - Color value for light mode
 * @param darkValue - Color value for dark mode
 */
export function getThemeColor(lightValue: string, darkValue: string): string {
  return getCurrentTheme() === 'dark' ? darkValue : lightValue;
}

/**
 * Theme color palette
 *
 * Access semantic colors that update based on current theme.
 */
export const themeColors = {
  get bgPrimary() {
    return getThemeColor('#ffffff', '#0a0f1a');
  },
  get bgSecondary() {
    return getThemeColor('#f8fafc', '#111827');
  },
  get bgTertiary() {
    return getThemeColor('#f1f5f9', '#1f2937');
  },
  get textPrimary() {
    return getThemeColor('#0f172a', '#f9fafb');
  },
  get textSecondary() {
    return getThemeColor('#475569', '#9ca3af');
  },
  get accentEmerald() {
    return getThemeColor('#059669', '#10b981');
  },
  get accentBlue() {
    return getThemeColor('#2563eb', '#3b82f6');
  },
  get accentAmber() {
    return getThemeColor('#d97706', '#f59e0b');
  },
  get accentRose() {
    return getThemeColor('#dc2626', '#f43f5e');
  },
  get borderColor() {
    return getThemeColor('#e2e8f0', 'rgba(255, 255, 255, 0.1)');
  },
};
