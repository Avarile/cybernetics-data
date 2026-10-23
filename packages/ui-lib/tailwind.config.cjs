const { join } = require('path');
const deepMerge = require('deepmerge');
const shadcnuiConfig = require('./tailwind.shadcnui.config.cjs');

const filePath = join(__dirname, './src/**/*.{js,ts,jsx,tsx}');
const buildFilePath = join(__dirname, './dist/**/*.{js,ts,jsx,tsx}');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [filePath, buildFilePath],
  darkMode: ['class'],
  theme: deepMerge(
    {
      extend: {
        colors: {
          neutral: {
            850: '#1e1e1e',
          },
          warning: 'hsl(var(--warning))',
          'warning-foreground': 'hsl(var(--warning-foreground))',
          'border-high': 'hsl(var(--border-high))',
          success: 'hsl(var(--success))',
          'success-foreground': 'hsl(var(--success-foreground))',
          surface: 'hsl(var(--surface))',
          'background-secondary': 'hsl(var(--background-secondary))',
          'foreground-tertiary': 'hsl(var(--foreground-tertiary))',
          'foreground-light': 'hsl(var(--foreground-light))',
          'border-light': 'hsl(var(--border-light))',
          selection: 'hsl(var(--selection))',
          hue: {
            blue: 'hsl(var(--hue-blue))',
            cyan: 'hsl(var(--hue-cyan))',
            gray: 'hsl(var(--hue-gray))',
            green: 'hsl(var(--hue-green))',
            orange: 'hsl(var(--hue-orange))',
            pink: 'hsl(var(--hue-pink))',
            purple: 'hsl(var(--hue-purple))',
            red: 'hsl(var(--hue-red))',
            teal: 'hsl(var(--hue-teal))',
            yellow: 'hsl(var(--hue-yellow))',
          },
        },
        fontSize: {
          '2xs': ['11px', '16px'],
          xs: ['12px', '16px'],
          sm: ['13px', '20px'],
        },
        boxShadow: {
          1: 'var(--shadow-1)',
          2: 'var(--shadow-2)',
        },
      },
    },
    shadcnuiConfig.theme
  ),
  plugins: [...shadcnuiConfig.plugins],
};
