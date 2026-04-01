/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        trust: {
          bg: '#0a0e1a',
          card: 'rgba(255, 255, 255, 0.06)',
          border: 'rgba(255, 255, 255, 0.08)',
          accent: '#E1306C',
          'accent-hover': '#F56040',
          'accent-light': '#F77737',
          green: '#22c55e',
          red: '#ef4444',
          yellow: '#f59e0b',
          text: '#e2e8f0',
          muted: '#64748b',
          dark: '#0d1224',
          surface: 'rgba(255, 255, 255, 0.04)',
        },
      },
      boxShadow: {
        'trust': '0 2px 8px rgba(0, 0, 0, 0.3), 0 0 1px rgba(255, 255, 255, 0.05)',
        'trust-md': '0 4px 16px rgba(0, 0, 0, 0.4), 0 0 1px rgba(255, 255, 255, 0.06)',
        'trust-lg': '0 8px 32px rgba(0, 0, 0, 0.5), 0 0 1px rgba(255, 255, 255, 0.08)',
        'glow-cyan': '0 0 20px rgba(225, 48, 108, 0.15), 0 0 40px rgba(225, 48, 108, 0.05)',
        'glow-accent': '0 0 20px rgba(225, 48, 108, 0.25), 0 0 40px rgba(245, 96, 64, 0.1)',
      },
      backgroundImage: {
        'glass-gradient': 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%)',
        'neo-gradient': 'linear-gradient(180deg, #0d1224 0%, #0a0e1a 50%, #080c16 100%)',
      },
    },
  },
  plugins: [],
};
