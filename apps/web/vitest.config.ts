import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // One test file at a time. Several older database tests use the first IC user / course offering they find
    // (courseOffering.findFirst()); on the unseeded CI database that can be another file's sentinel row while that
    // file is still running, and its clean-up then fails (seen in v1.4.2 ci-local on da2a066). Run in sequence,
    // no file can borrow another's rows mid-run.
    fileParallelism: false,
  },
});
