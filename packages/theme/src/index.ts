// @naap/theme - Design tokens and Tailwind configuration
// Aligned with Livepeer brand system (https://livepeer-website.vercel.app/brand)

// ============================================
// Color Tokens
// ============================================

export const colors = {
  // Surface scale (dark mode) — Livepeer brand
  // Frame (#121212) → Surface (#1A1A1A) → Elevated (#222222)
  bgPrimary: '#121212',
  bgSecondary: '#1A1A1A',
  bgTertiary: '#222222',
  bgBorder: '#2A2A2A',

  // Surface scale (light mode)
  bgPrimaryLight: '#ffffff',
  bgSecondaryLight: '#f8fafc',
  bgTertiaryLight: '#f1f5f9',
  bgBorderLight: '#e2e8f0',

  // Text colors (dark mode) — Livepeer 6-level opacity hierarchy
  textPrimary: 'rgba(255, 255, 255, 1)',          // 100% — headings
  textSecondary: 'rgba(255, 255, 255, 0.7)',       // 70% — strong secondary
  textBody: 'rgba(255, 255, 255, 0.6)',            // 60% — body/descriptions
  textSupporting: 'rgba(255, 255, 255, 0.5)',      // 50% — supporting text
  textMuted: 'rgba(255, 255, 255, 0.4)',           // 40% — labels/metadata
  textDisabled: 'rgba(255, 255, 255, 0.25)',       // 25% — disabled/hints

  // Text colors (light mode)
  textPrimaryLight: '#0f172a',
  textSecondaryLight: '#334155',
  textBodyLight: '#475569',
  textSupportingLight: '#64748b',
  textMutedLight: '#94a3b8',
  textDisabledLight: '#cbd5e1',

  // Brand accent — Livepeer green
  accentGreen: '#18794E',
  accentGreenLight: '#1E9960',
  accentGreenBright: '#40BF86',

  // Secondary accents
  accentBlue: '#3b82f6',
  accentAmber: '#f59e0b',
  accentRose: '#f43f5e',
  accentPurple: '#8b5cf6',

  // Status colors
  statusSuccess: '#18794E',
  statusWarning: '#f59e0b',
  statusError: '#f43f5e',
  statusInfo: '#3b82f6',
} as const;

// ============================================
// Typography
// ============================================

export const fontFamily = {
  sans: ['Inter', 'system-ui', 'sans-serif'],
  mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
} as const;

export const typeScale = {
  display: { size: '2rem', weight: '700', tracking: '-0.02em', leading: '1.2' },
  heading: { size: '1.25rem', weight: '600', tracking: '-0.01em', leading: '1.4' },
  subhead: { size: '0.875rem', weight: '600', tracking: '0', leading: '1.5' },
  body: { size: '0.875rem', weight: '400', tracking: '0', leading: '1.5' },
  caption: { size: '0.75rem', weight: '500', tracking: '0', leading: '1.5' },
  label: { size: '0.6875rem', weight: '600', tracking: '0.05em', leading: '1.4' },
  mono: { size: '0.8125rem', weight: '500', tracking: '0', leading: '1.5' },
} as const;

// ============================================
// Spacing
// ============================================

export const spacing = {
  xs: '0.25rem',   // 4px
  sm: '0.5rem',    // 8px
  md: '1rem',      // 16px
  lg: '1.5rem',    // 24px
  xl: '2rem',      // 32px
  '2xl': '3rem',   // 48px
} as const;

// ============================================
// Border Radius
// ============================================

export const borderRadius = {
  sm: '0.375rem',   // 6px
  md: '0.5rem',     // 8px
  lg: '0.75rem',    // 12px
  xl: '1rem',       // 16px
  '2xl': '1.5rem',  // 24px
  full: '9999px',
} as const;

// ============================================
// Motion
// ============================================

export const motion = {
  instant: '100ms',   // hover states, focus rings
  fast: '150ms',      // tooltips, dropdowns
  normal: '200ms',    // modals, panels
  slow: '300ms',      // sidebar, page transitions
  easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
  easingOut: 'cubic-bezier(0, 0, 0.2, 1)',
  easingIn: 'cubic-bezier(0.4, 0, 1, 1)',
} as const;

// ============================================
// Tailwind Extension Config
// ============================================

export const tailwindExtend = {
  colors: {
    'bg-primary': 'var(--bg-primary)',
    'bg-secondary': 'var(--bg-secondary)',
    'bg-tertiary': 'var(--bg-tertiary)',
    'text-primary': 'var(--text-primary)',
    'text-secondary': 'var(--text-secondary)',
    'text-body': 'var(--text-body)',
    'text-supporting': 'var(--text-supporting)',
    'text-muted': 'var(--text-muted)',
    'text-disabled': 'var(--text-disabled)',
    'accent-green': 'var(--accent-green)',
    'accent-blue': 'var(--accent-blue)',
    'accent-amber': 'var(--accent-amber)',
    'accent-rose': 'var(--accent-rose)',
    'accent-purple': 'var(--accent-purple)',
  },
  fontFamily: {
    sans: ['Inter', 'system-ui', 'sans-serif'],
    mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
  },
  borderRadius: {
    sm: '0.375rem',
    md: '0.5rem',
    lg: '0.75rem',
    xl: '1rem',
    '2xl': '1.5rem',
  },
  transitionDuration: {
    instant: '100ms',
    fast: '150ms',
    normal: '200ms',
    slow: '300ms',
  },
  transitionTimingFunction: {
    'ease-out-smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
};

export type ThemeColors = typeof colors;
export type ThemeSpacing = typeof spacing;
export type ThemeTypeScale = typeof typeScale;
export type ThemeMotion = typeof motion;
