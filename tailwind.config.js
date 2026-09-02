/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#F0FDF4',
          100: '#DCFCE7',
          500: '#10B981',
          600: '#059669',
          700: '#047857',
        },
        surface: {
          light: '#FAFAFA',
          card: '#FFFFFF',
          dark: '#09090B',
          'dark-card': '#121215',
          'dark-border': '#27272A',
        }
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        'glow-brand': '0 0 24px -4px rgba(16, 185, 129, 0.25)',
        'glow-card': '0 12px 32px -8px rgba(0, 0, 0, 0.08)',
      }
    },
  },
  plugins: [],
}
