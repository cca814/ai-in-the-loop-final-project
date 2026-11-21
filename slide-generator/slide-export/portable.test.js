import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import JSZip from 'jszip';
import { exportPortable } from './portable.js';
import { createPortableServer } from './portable-server.mjs';
import { buildWebSlides } from './web.js';

test('portable build uses root base and local fonts without rewriting the original source', async () => {
  let directory;
  try {
    const result = await buildWebSlides('---\ntheme: default\n---\n# Example', { portable: true, run: async (_node, args, options) => {
      const { dirname } = await import('node:path');
      directory = dirname(args[2]);
      assert.equal(args[4], '/');
      assert.ok(!('GEMINI_API_KEY' in options.env));
      assert.match(await readFile(args[2], 'utf8'), /fonts:\n  provider: none/);
      await mkdir(join(directory, 'dist'));
      await writeFile(join(directory, 'dist/index.html'), '<h1>Example</h1>');
    } });
    assert.equal(result.directory, directory);
  } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
});

test('ZIP contains only playback files, original slides and instructions, and cleans its build', async () => {
  const directory = await mkdtemp(new URL('./node_modules/portable-test-', import.meta.url));
  const slides = '---\ntheme: default\n---\n# Example';
  const data = await exportPortable(slides, { build: async (source, options) => {
    assert.equal(source, slides);
    assert.equal(options.portable, true);
    await mkdir(join(directory, 'dist/assets'), { recursive: true });
    await writeFile(join(directory, 'dist/index.html'), '<h1>Example</h1>');
    await writeFile(join(directory, 'dist/assets/app.js'), '/* app */');
    await writeFile(join(directory, '.env.local'), 'FAKE_SENTINEL_DO_NOT_INCLUDE');
    return { directory };
  } });
  const zip = await JSZip.loadAsync(data);
  assert.equal(await zip.file('presentation/slides.md').async('string'), slides);
  assert.match(await zip.file('presentation/serve.mjs').async('string'), /127\.0\.0\.1/);
  assert.ok(zip.file('presentation/start.cmd'));
  assert.ok(zip.file('presentation/README.txt'));
  assert.ok(zip.file('presentation/site/assets/app.js'));
  assert.ok(!Object.keys(zip.files).some(name => name.includes('.env')));
  await assert.rejects(stat(directory), { code: 'ENOENT' });
});

test('rejects images before building so offline images cannot silently disappear', async () => {
  await assert.rejects(exportPortable('# Image\n![image](https://example.com/test.png)', { build: () => { throw new Error('Should not build'); } }), /images are not supported/);
});

test('included server serves assets and SPA routes but rejects traversal and writes', async () => {
  const directory = await mkdtemp(new URL('./node_modules/portable-server-test-', import.meta.url));
  await writeFile(join(directory, 'index.html'), '<h1>Deck</h1>');
  await writeFile(join(directory, 'app.js'), '/* deck */');
  const server = createPortableServer(directory);
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${server.address().port}`;
    assert.equal(await (await fetch(`${url}/2`)).text(), '<h1>Deck</h1>');
    assert.match((await fetch(`${url}/app.js`)).headers.get('content-type'), /javascript/);
    assert.equal((await fetch(`${url}/%2e%2e%2foutside`)).status, 404);
    assert.equal((await fetch(`${url}/missing.js`)).status, 404);
    assert.equal((await fetch(`${url}/`, { method: 'POST' })).status, 405);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
