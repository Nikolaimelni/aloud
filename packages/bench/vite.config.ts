import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 4300,
    headers: {
      // Same as the app: onnxruntime only starts its thread pool when the page is isolated.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  // @aloud/core ships TypeScript source; prebundling it breaks its relative imports.
  optimizeDeps: { exclude: ['@aloud/core'] },
  worker: { format: 'es' },
});
