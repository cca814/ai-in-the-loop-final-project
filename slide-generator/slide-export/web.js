import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
// Build outputs are runtime artifacts, not application sources. Keeping them
// under node_modules also excludes bundled vendor JS from the parent ESLint run.
const decksRoot = join(root, 'node_modules/.report-presentations');
const execute = promisify(execFile);
const lifetime = 2 * 60 * 60 * 1000;
const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function cleanExpired() {
  await mkdir(decksRoot, { recursive: true });
  const entries = await readdir(decksRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !validId.test(entry.name)) continue;
    const directory = join(decksRoot, entry.name);
    try {
      if (Date.now() - (await stat(directory)).mtimeMs > lifetime) await rm(directory, { recursive: true, force: true });
    } catch { /* Another local build may already have removed an expired deck. */ }
  }
}

export async function buildWebSlides(slides, { run = execute, portable = false } = {}) {
  await cleanExpired();
  const id = randomUUID();
  const directory = join(decksRoot, id);
  const base = portable ? '/' : `/api/reports/present/${id}/`;
  await mkdir(directory);
  try {
    const entry = join(directory, 'slides.md');
    // The portable build uses system fonts without contacting a font CDN.
    const buildSource = portable ? slides.replace(/^---\r?\n/, '---\nfonts:\n  provider: none\n') : slides;
    await writeFile(entry, buildSource, 'utf8');
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, USERPROFILE: process.env.USERPROFILE, NODE_ENV: 'production' };
    await run(process.execPath, [join(root, 'node_modules/@slidev/cli/bin/slidev.mjs'), 'build', entry, '--base', base, '--out', 'dist'], { cwd: root, env, timeout: 120_000, maxBuffer: 2_000_000, windowsHide: true });
    await stat(join(directory, 'dist/index.html'));
    return portable ? { directory } : { url: base, expiresAt: new Date(Date.now() + lifetime).toISOString() };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function serveWebSlides(id, assets = []) {
  if (!validId.test(id) || !Array.isArray(assets) || assets.some(part => !/^[a-zA-Z0-9._-]+$/.test(part) || part === '.' || part === '..')) return new Response('Not found', { status: 404 });
  const directory = join(decksRoot, id);
  try {
    if (Date.now() - (await stat(directory)).mtimeMs > lifetime) return new Response('This local presentation has expired. Generate it again from the report workspace.', { status: 410 });
    let path = join(directory, 'dist', ...assets);
    // Slidev's history router needs the HTML entry on direct slide navigation.
    if (!assets.length || !extname(assets.at(-1))) path = join(directory, 'dist/index.html');
    const file = await readFile(path);
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
    return new Response(new Uint8Array(file), { headers: { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
  } catch { return new Response('Not found', { status: 404 }); }
}
