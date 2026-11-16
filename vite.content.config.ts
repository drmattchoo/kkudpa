// Content script: one IIFE file. In --mode test it also exposes the driver on
// window.__kkuDpa so the Playwright DOM tests can call it against saved pages.
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig(({ mode }) => ({
  define: { __TEST_HOOKS__: JSON.stringify(mode === 'test') },
  build: {
    outDir: resolve(__dirname, mode === 'test' ? 'tests/.build' : 'dist'),
    emptyOutDir: false,
    target: 'chrome120',
    minify: false,
    lib: {
      entry: resolve(__dirname, 'src/content/index.ts'),
      formats: ['iife'],
      name: 'kkuDpaContent',
      fileName: () => 'content.js',
    },
  },
}));
