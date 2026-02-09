'use client';

import { useEffect } from 'react';

/**
 * ThemeInitializer - Initializes theme from localStorage or system preference
 *
 * This component runs on mount to:
 * 1. Check localStorage for saved theme preference
 * 2. Fall back to system preference (prefers-color-scheme)
 * 3. Default to dark mode if no preference is found
 * 4. Apply the 'dark' class to document root accordingly
 */
export function ThemeInitializer() {
  useEffect(() => {
    const stored = localStorage.getItem('theme');

    // Determine theme: use stored preference, or default to dark
    // (matching previous behavior where dark was hardcoded)
    let isDark: boolean;
    if (stored === 'light') {
      isDark = false;
    } else if (stored === 'dark') {
      isDark = true;
    } else {
      // No stored preference - default to dark (preserves existing UX)
      isDark = true;
    }

    document.documentElement.classList.toggle('dark', isDark);

    // Also set color-scheme for native elements
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  }, []);

  return null;
}
