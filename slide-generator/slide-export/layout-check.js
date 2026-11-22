import { chromium } from 'playwright-chromium';
import { readdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { buildWebSlides } from './web.js';
import { createPortableServer } from './portable-server.mjs';

const root = dirname(fileURLToPath(import.meta.url));
async function localBrowser() {
  const directory = join(root, 'node_modules/.playwright-browsers');
  try {
    for (const entry of await readdir(directory)) {
      if (!/^chromium-\d+$/.test(entry)) continue;
      for (const suffix of ['chrome-win64/chrome.exe', 'chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const executable = join(directory, entry, suffix);
        try { await stat(executable); return executable; } catch { /* Try another platform. */ }
      }
    }
  } catch { /* Playwright's configured/default browser directory remains usable. */ }
}

export async function checkLayout(slides, { signal, build = buildWebSlides } = {}) {
  const { directory } = await build(slides, { portable: true, signal });
  const server = createPortableServer(join(directory, 'dist'));
  let browser;
  const abort = () => { void browser?.close().catch(() => {}); server.closeAllConnections(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/`;
    const env = Object.fromEntries(['PATH', 'SystemRoot', 'TEMP', 'TMP', 'USERPROFILE', 'HOME'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    browser = await chromium.launch({ headless: true, executablePath: await localBrowser(), env });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    const count = (slides.match(/^#\s+\S/gm) || []).length;
    if (!count || count > 100) throw new Error('Invalid slide count');
    const pages = [];
    for (let index = 0; index < count; index++) {
      signal?.throwIfAborted();
      await page.goto(`${base}${index + 1}?clicks=99999`, { waitUntil: 'networkidle', timeout: 30_000 });
      const layout = page.locator('#slide-content .slidev-layout:visible').first();
      await layout.waitFor({ state: 'visible', timeout: 15_000 });
      await page.evaluate(() => document.fonts.ready);
      if (await layout.locator('img').evaluateAll(images => images.some(image => !image.complete || !image.naturalWidth))) throw new Error('Image assets could not be verified');
      await page.addStyleTag({ content: '.slidev-vclick-target { transition: none !important; animation: none !important; transform: none !important; opacity: 1 !important; visibility: visible !important; }' });
      pages.push(await layout.evaluate((element, number) => {
        const frame = (element.closest('#slide-content') || element).getBoundingClientRect();
        const content = [...element.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,table,pre,a')].map(child => child.getBoundingClientRect());
        return { page: number, overflowX: content.some(rect => rect.width && (rect.right > frame.right + 3 || rect.left < frame.left - 3)), overflowY: content.some(rect => rect.height && (rect.bottom > frame.bottom + 3 || rect.top < frame.top - 3)) };
      }, index + 1));
    }
    if (!pages.length) throw new Error('No slides rendered');
    return { checkedPages: pages.length, overflowPages: pages.filter(page => page.overflowX || page.overflowY), method: 'rendered-dom-bounds; review typography and clipping manually' };
  } finally {
    signal?.removeEventListener('abort', abort);
    await browser?.close();
    server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}
