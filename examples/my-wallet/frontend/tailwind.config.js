/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', '../../../packages/ui/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'bg-primary': 'var(--bg-primary)', 'bg-secondary': 'var(--bg-secondary)', 'bg-tertiary': 'var(--bg-tertiary)',
        'text-primary': 'var(--text-primary)', 'text-secondary': 'var(--text-secondary)',
        'accent-emerald': 'var(--accent-emerald)', 'accent-blue': 'var(--accent-blue)',
        'accent-amber': 'var(--accent-amber)', 'accent-rose': 'var(--accent-rose)',
        'accent-purple': 'var(--accent-purple, #8b5cf6)',
      },
      fontFamily: { outfit: ['Outfit', 'sans-serif'], mono: ['JetBrains Mono', 'monospace'] },
    },
  },
  plugins: [],
};
