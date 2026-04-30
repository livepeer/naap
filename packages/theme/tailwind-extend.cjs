/**
 * Shared Tailwind theme.extend for web-next, AgentBook plugins, and any UMD shell embed.
 * Single source of truth — keep in sync with CSS variables in @naap/theme shell-variables.css / web-next globals.
 */
module.exports = {
  colors: {
    border: 'hsl(var(--border))',
    input: 'hsl(var(--input))',
    ring: 'hsl(var(--ring))',
    background: 'hsl(var(--background))',
    foreground: 'hsl(var(--foreground))',
    primary: {
      DEFAULT: 'hsl(var(--primary))',
      foreground: 'hsl(var(--primary-foreground))',
    },
    secondary: {
      DEFAULT: 'hsl(var(--secondary))',
      foreground: 'hsl(var(--secondary-foreground))',
    },
    destructive: {
      DEFAULT: 'hsl(var(--destructive))',
      foreground: 'hsl(var(--destructive-foreground))',
    },
    muted: {
      DEFAULT: 'hsl(var(--muted))',
      foreground: 'hsl(var(--muted-foreground))',
    },
    accent: {
      DEFAULT: 'hsl(var(--accent))',
      foreground: 'hsl(var(--accent-foreground))',
    },
    popover: {
      DEFAULT: 'hsl(var(--popover))',
      foreground: 'hsl(var(--popover-foreground))',
    },
    card: {
      DEFAULT: 'hsl(var(--card))',
      foreground: 'hsl(var(--card-foreground))',
    },
    'surface-primary': 'var(--bg-primary)',
    'surface-secondary': 'var(--bg-secondary)',
    'surface-tertiary': 'var(--bg-tertiary)',
    'content-primary': 'var(--text-primary)',
    'content-secondary': 'var(--text-secondary)',
    'content-body': 'var(--text-body)',
    'content-supporting': 'var(--text-supporting)',
    'content-muted': 'var(--text-muted)',
    'content-disabled': 'var(--text-disabled)',
    'accent-green': 'var(--accent-green)',
    'accent-blue': 'var(--accent-blue)',
    'accent-amber': 'var(--accent-amber)',
    'accent-rose': 'var(--accent-rose)',
    'accent-purple': 'var(--accent-purple)',
    'accent-emerald': 'var(--accent-emerald)',
    'bg-primary': 'var(--bg-primary)',
    'bg-secondary': 'var(--bg-secondary)',
    'bg-tertiary': 'var(--bg-tertiary)',
    'text-primary': 'var(--text-primary)',
    'text-secondary': 'var(--text-secondary)',
    success: 'hsl(var(--success))',
    warning: 'hsl(var(--warning))',
    error: 'hsl(var(--error))',
    info: 'hsl(var(--info))',
    naap: {
      'bg-primary': '#181818',
      'bg-secondary': '#1E1E1E',
      'bg-tertiary': '#242424',
      green: '#18794E',
      blue: '#3b82f6',
      amber: '#f59e0b',
      rose: '#f43f5e',
    },
  },
  borderRadius: {
    lg: 'var(--radius)',
    md: 'calc(var(--radius) - 2px)',
    sm: 'calc(var(--radius) - 4px)',
  },
  fontFamily: {
    sans: ['Inter', 'system-ui', 'sans-serif'],
    mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
  },
  transitionDuration: {
    instant: '100ms',
    fast: '150ms',
    normal: '200ms',
    slow: '300ms',
  },
  transitionTimingFunction: {
    'ease-smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
    'ease-out-smooth': 'cubic-bezier(0, 0, 0.2, 1)',
  },
  keyframes: {
    'accordion-down': {
      from: { height: 0 },
      to: { height: 'var(--radix-accordion-content-height)' },
    },
    'accordion-up': {
      from: { height: 'var(--radix-accordion-content-height)' },
      to: { height: 0 },
    },
    shimmer: {
      '0%': { backgroundPosition: '-1000px 0' },
      '100%': { backgroundPosition: '1000px 0' },
    },
    pulse: {
      '0%, 100%': { opacity: 1 },
      '50%': { opacity: 0.5 },
    },
    fadeIn: {
      from: { opacity: 0 },
      to: { opacity: 1 },
    },
    fadeOut: {
      from: { opacity: 1 },
      to: { opacity: 0 },
    },
    slideIn: {
      from: { transform: 'translateY(10px)', opacity: 0 },
      to: { transform: 'translateY(0)', opacity: 1 },
    },
  },
  animation: {
    'accordion-down': 'accordion-down 0.2s ease-out',
    'accordion-up': 'accordion-up 0.2s ease-out',
    shimmer: 'shimmer 2s infinite linear',
    pulse: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
    fadeIn: 'fadeIn 0.2s ease-out',
    fadeOut: 'fadeOut 0.2s ease-in',
    slideIn: 'slideIn 0.3s ease-out',
  },
  backdropBlur: {
    xs: '2px',
  },
};
