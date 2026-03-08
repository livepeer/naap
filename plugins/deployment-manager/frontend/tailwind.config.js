/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border, 214 32% 91%))',
        input: 'hsl(var(--input, 214 32% 91%))',
        ring: 'hsl(var(--ring, 217 91% 60%))',
        background: 'hsl(var(--background, 0 0% 100%))',
        foreground: 'hsl(var(--foreground, 222 47% 11%))',
        primary: {
          DEFAULT: 'hsl(var(--primary, 153 66% 28%))',
          foreground: 'hsl(var(--primary-foreground, 0 0% 100%))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary, 210 40% 96%))',
          foreground: 'hsl(var(--secondary-foreground, 222 47% 11%))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive, 0 84% 60%))',
          foreground: 'hsl(var(--destructive-foreground, 0 0% 98%))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted, 210 40% 96%))',
          foreground: 'hsl(var(--muted-foreground, 215 16% 47%))',
        },
        card: {
          DEFAULT: 'hsl(var(--card, 210 40% 98%))',
          foreground: 'hsl(var(--card-foreground, 222 47% 11%))',
        },
        'dm-blue': 'var(--dm-accent-blue, #3b82f6)',
      },
      borderRadius: {
        lg: '0.5rem',
        md: '0.375rem',
        sm: '0.25rem',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};
