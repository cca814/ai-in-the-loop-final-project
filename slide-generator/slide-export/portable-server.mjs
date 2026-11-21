// This file is also shipped in the portable ZIP. Only Node.js built-ins are used.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function createPortableServer(site) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
  return createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    try {
      const segments = decodeURIComponent(request.url.split('?')[0]).split('/').filter(Boolean);
      if (segments.some(part => !/^[a-zA-Z0-9._-]+$/.test(part) || part === '.' || part === '..')) {
        response.writeHead(404); response.end(); return;
      }
      const file = !segments.length || !extname(segments.at(-1)) ? join(site, 'index.html') : join(site, ...segments);
      const data = await readFile(file);
      response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch { response.writeHead(404); response.end(); }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createPortableServer(join(dirname(fileURLToPath(import.meta.url)), 'site'));
  server.on('error', () => { console.error('Unable to start presentation server.'); process.exitCode = 1; });
  server.listen(0, '127.0.0.1', () => {
    console.log(`Open presentation: http://127.0.0.1:${server.address().port}/`);
    console.log('Keep this window open. Press Ctrl+C to stop.');
  });
}
