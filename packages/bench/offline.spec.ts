import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { preview } from 'vite';

const ROOT = fileURLToPath(new URL('../app/dist/app/browser', import.meta.url));
const PORT = 4400;

/**
 * The headers Cloudflare Pages sends, read out of the `_headers` that ships with the build, so
 * the thing under test is the thing that ships, CSP included. Only the `/*` block is used.
 */
async function shippedHeaders(): Promise<Record<string, string>> {
  const text = await readFile(`${ROOT}/_headers`, 'utf8');
  const headers: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s+([\w-]+):\s*(.+)$/.exec(line);
    if (match?.[1] && match[2]) headers[match[1]] = match[2];
  }
  return headers;
}

test('the app opens with the network off', async ({ browser }) => {
  const server = await preview({
    configFile: false,
    logLevel: 'silent',
    root: ROOT,
    build: { outDir: '.' },
    preview: { port: PORT, strictPort: true, headers: await shippedHeaders() },
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  const blocked: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) blocked.push(message.text());
  });

  try {
    const response = await page.goto(`http://localhost:${PORT}/`);
    expect(response?.headers()['content-security-policy']).toContain("connect-src 'self'");
    await expect(page.locator('aloud-session')).toBeVisible();

    await page.evaluate(() => navigator.serviceWorker.ready);

    // Every file the manifest lists, not just the page: index.html alone comes back with no
    // application behind it, which is how this test failed the first time it was written.
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const manifest: { assetGroups?: { installMode: string; urls: string[] }[] } = await (
              await fetch('/ngsw.json')
            ).json();
            const wanted = (manifest.assetGroups ?? [])
              .filter((group) => group.installMode === 'prefetch')
              .flatMap((group) => group.urls);

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
    expect(blocked, blocked.join('\n')).toEqual([]);
  } finally {
    await context.close();
    await server.close();
  }
});
