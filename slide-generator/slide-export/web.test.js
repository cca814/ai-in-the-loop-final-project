import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildWebSlides, serveWebSlides } from './web.js';

test('builds and serves a deck with its own base URL, assets and SPA routes', async () => {
  let directory;
  try {
    const deck = await buildWebSlides('# Example', { run: async (_node, args, options) => {
      directory = dirname(args[2]);
      assert.equal(args[1], 'build');
      assert.match(args[4], /^\/api\/reports\/present\/[a-f0-9-]+\/$/);
      assert.ok(!('GEMINI_API_KEY' in options.env));
      await mkdir(join(directory, 'dist/assets'), { recursive: true });
      await writeFile(join(directory, 'dist/index.html'), '<h1>Example</h1>');
      await writeFile(join(directory, 'dist/assets/deck.js'), 'console.log("deck")');
    } });
    const id = deck.url.split('/').filter(Boolean).at(-1);
    assert.ok(Date.parse(deck.expiresAt) > Date.now());
    assert.equal(await (await serveWebSlides(id)).text(), '<h1>Example</h1>');
    assert.match((await serveWebSlides(id, ['assets', 'deck.js'])).headers.get('content-type'), /javascript/);
    assert.equal((await serveWebSlides(id, ['2'])).status, 200);
    assert.equal((await serveWebSlides(id, ['..', 'index.html'])).status, 404);
    assert.equal((await serveWebSlides(id, ['assets', 'missing.js'])).status, 404);
  } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
});

test('failed builds remove their own temporary deck', async () => {
  let directory;
  await assert.rejects(buildWebSlides('# Example', { run: async (_node, args) => { directory = dirname(args[2]); throw new Error('Build failed'); } }), /Build failed/);
  await assert.rejects(stat(directory), { code: 'ENOENT' });
  assert.equal((await serveWebSlides('../unsafe')).status, 404);
});
