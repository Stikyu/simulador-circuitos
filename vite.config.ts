import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// En producción la app vive en https://stikyu.github.io/simulador-circuitos/
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/simulador-circuitos/' : '/',
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
}));
