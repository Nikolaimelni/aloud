import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { expect, test } from '@playwright/test';

const ROOT = '../app/dist/app/browser';
const PORT = 4400;

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

/**
 * Serves the production build with the two headers `public/_headers` asks Pages to send, so
 * the thing under test is the thing that ships.
 */
function serve(): Promise<Server> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));

    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');

    readFile(file).then(
      (body) => {
        response.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
        response.end(body);
      },
      () => {
        response.statusCode = 404;
        response.end('no');
      },
    );
  });

  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

test('the app opens with the network off', async ({ browser }) => {
  const server = await serve();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(`http://localhost:${PORT}/`);
    await expect(page.locator('aloud-session')).toBeVisible();

    await page.evaluate(() => navigator.serviceWorker.ready);

    // Every file the manifest lists, not just the page: index.html alone comes back with no
    // application behind it, which is how this test failed the first time it was written.
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const manifest: { assetGroups?: { urls: string[] }[] } = await (
              await fetch('/ngsw.json')
            ).json();
            const wanted = (manifest.assetGroups ?? []).flatMap((group) => group.urls);

            for (const name of await caches.keys()) {
              const cache = await caches.open(name);
              const present = await Promise.all(wanted.map((url) => cache.match(url)));
              if (wanted.length > 0 && present.every(Boolean)) return true;
            }
            return false;
          }),
        { timeout: 60_000, message: 'the service worker never finished caching the shell' },
      )
      .toBe(true);

    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Bootstrapping from cache is not instant, and the default expect timeout is five seconds.
    await expect(page.locator('h1')).toHaveText('Aloud', { timeout: 30_000 });
    await expect(page.locator('.source')).toHaveCount(3);
  } finally {
    await context.close();
    server.close();
  }
});
