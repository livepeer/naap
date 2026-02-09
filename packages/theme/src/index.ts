// @naap/theme - Design tokens and Tailwind configuration

export const colors = {
  // Background colors
  bgPrimary: '#0a0f1a',
  bgSecondary: '#111827',
  bgTertiary: '#1f2937',
  
  // Text colors
  textPrimary: '#f9fafb',
  textSecondary: '#9ca3af',
  
  // Accent colors
  accentEmerald: '#10b981',
  accentBlue: '#3b82f6',
  accentAmber: '#f59e0b',
  accentRose: '#f43f5e',
} as const;

export const fontFamily = {
  outfit: ['Outfit', 'sans-serif'],
  mono: ['JetBrains Mono', 'monospace'],
} as const;

export const spacing = {
  xs: '0.25rem',
  sm: '0.5rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2rem',
  '2xl': '3rem',
} as const;

export const borderRadius = {
  sm: '0.5rem',
  md: '0.75rem',
  lg: '1rem',
  xl: '1.5rem',
  '2xl': '2rem',
  full: '9999px',
} as const;

// CSS variables for runtime theming
export const cssVariables = `
  :root {
    --bg-primary: ${colors.bgPrimary};
    --bg-secondary: ${colors.bgSecondary};
    --bg-tertiary: ${colors.bgTertiary};
    --text-primary: ${colors.textPrimary};
    --text-secondary: ${colors.textSecondary};
    --accent-emerald: ${colors.accentEmerald};
    --accent-blue: ${colors.accentBlue};
    --accent-amber: ${colors.accentAmber};
    --accent-rose: ${colors.accentRose};
  }
`;

// Tailwind extend configuration
export const tailwindExtend = {
  colors: {
    'bg-primary': 'var(--bg-primary)',
    'bg-secondary': 'var(--bg-secondary)',
    'bg-tertiary': 'var(--bg-tertiary)',
    'text-primary': 'var(--text-primary)',
    'text-secondary': 'var(--text-secondary)',
    'accent-emerald': 'var(--accent-emerald)',
    'accent-blue': 'var(--accent-blue)',
    'accent-amber': 'var(--accent-amber)',
    'accent-rose': 'var(--accent-rose)',
  },
  fontFamily: {
    outfit: ['Outfit', 'sans-serif'],
    mono: ['JetBrains Mono', 'monospace'],
  },
  borderRadius: {
    'xl': '1rem',
    '2xl': '1.5rem',
    '3xl': '2rem',
  },
};

export type ThemeColors = typeof colors;
export type ThemeSpacing = typeof spacing;
