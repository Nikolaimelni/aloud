import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 30 * 60 * 1000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4300',
    // Headless Chromium cannot get a GPU adapter on this machine whatever flags it is given,
    // so a WebGPU measurement has to run with a window open. BENCH_HEADED=1 does that.
    headless: process.env['BENCH_HEADED'] !== '1',
    launchOptions: {
      args: [
        // Headless Chromium needs telling that WebGPU is allowed; without these the bench
        // silently measures WASM twice and the comparison is worthless.
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan',
        '--use-angle=vulkan',
      ],
    },
  },
  // Only the measurement spec needs the Vite page; the offline check serves the built app
  // itself, because that is the artefact whose offline behaviour is in question.
  webServer: {
    command: 'pnpm exec vite --port 4300 --strictPort',
    url: 'http://localhost:4300',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
