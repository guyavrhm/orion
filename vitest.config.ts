import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    pool: 'forks',
    forks: {
      singleFork: true
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/main/**/*.ts', 'src/client/**/*.{ts,tsx}'],
      exclude: ['src/main/types/**', 'dist/**', 'node_modules/**']
    }
  },
  resolve: {
    alias: {
      '@main': path.resolve(__dirname, './src/main'),
      '@client': path.resolve(__dirname, './src/client'),
      '@': path.resolve(__dirname, './src/client')
    }
  }
});
