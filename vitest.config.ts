import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@dreamcity/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./packages/web/src', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    globals: false,
  },
});
