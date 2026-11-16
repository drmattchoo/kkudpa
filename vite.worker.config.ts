// Service worker: one ES module file (manifest declares "type": "module").
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: false,
    target: 'chrome120',
    lib: {
      entry: resolve(__dirname, 'src/background/index.ts'),
      formats: ['es'],
      fileName: () => 'background.js',
    },
    // Service workers cannot use dynamic import(): bundle everything into one file.
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
