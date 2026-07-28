import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    // Alleen de TS/TSX-tests van deze app. De bestaande scripts/*.test.mjs
    // draaien op node:test (node --test) en horen niet bij vitest.
    include: ['**/*.test.ts', '**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
