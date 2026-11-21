import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const execute = promisify(execFile);

export async function exportPptx(slides, { format = 'pptx', run = execute } = {}) {
  if (!['pptx', 'pptx-editable'].includes(format)) throw new Error('Unsupported PPTX format');
  const cli = join(root, 'node_modules/@slidev/cli/bin/slidev.mjs');
  await stat(cli);
  const jobsRoot = join(root, '.exports');
  await mkdir(jobsRoot, { recursive: true });
  const job = await mkdtemp(join(jobsRoot, 'job-'));
  try {
    const entry = join(job, 'slides.md');
    const output = join(job, 'slides.pptx');
    await writeFile(entry, slides, 'utf8');
    // Do not forward API keys or load .env.local in the renderer process.
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, USERPROFILE: process.env.USERPROFILE, NODE_ENV: 'development' };
    const localBrowsers = join(root, 'node_modules/.playwright-browsers');
    try { await stat(localBrowsers); env.PLAYWRIGHT_BROWSERS_PATH = localBrowsers; } catch { /* Use Playwright's default browser location. */ }
    await run(process.execPath, [cli, 'export', entry, '--format', format, '--output', output, '--with-clicks', 'false'], { cwd: root, env, timeout: 120_000, maxBuffer: 2_000_000, windowsHide: true });
    const buffer = await readFile(output);
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new Error('Invalid PPTX output');
    return buffer;
  } finally {
    await rm(job, { recursive: true, force: true });
  }
}
