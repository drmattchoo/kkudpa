// Side panel build (HTML entry). The content script and service worker are built
// separately as single self-contained files: MV3 content scripts cannot be ES modules.
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { copyFileSync, mkdirSync } from 'node:fs';

export default defineConfig({
  root: resolve(__dirname, 'src/sidepanel'),
  base: './',
  publicDir: resolve(__dirname, 'public'),
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'chrome120',
    rollupOptions: { input: resolve(__dirname, 'src/sidepanel/index.html') },
  },
  plugins: [
    {
      name: 'copy-pdf-worker',
      closeBundle() {
        mkdirSync(resolve(__dirname, 'dist'), { recursive: true });
        copyFileSync(
          resolve(__dirname, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'),
          resolve(__dirname, 'dist/pdf.worker.min.mjs'),
        );
      },
    },
  ],
});
