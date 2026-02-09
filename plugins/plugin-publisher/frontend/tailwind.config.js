/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'bg-primary': 'var(--bg-primary)',
        'bg-secondary': 'var(--bg-secondary)',
        'bg-tertiary': 'var(--bg-tertiary)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-tertiary': 'var(--text-tertiary)',
        'accent-emerald': 'var(--accent-emerald)',
        'accent-blue': 'var(--accent-blue)',
        'accent-amber': 'var(--accent-amber)',
        'accent-rose': 'var(--accent-rose)',
        'accent-purple': 'var(--accent-purple)',
        'border': 'var(--border-color)',
      },
    },
  },
  plugins: [],
};
