// Manual renderer check using only generated example slides, never credentials.
import { readFile, writeFile } from 'node:fs/promises';
import { exportPptx } from './export.js';

try {
  const input = process.argv[2];
  const output = process.argv[3];
  if (!input || !output) throw new Error('Usage: node export-check.mjs <slides.md> <output.pptx>');
  const file = await exportPptx(await readFile(input, 'utf8'));
  await writeFile(output, file, { flag: 'wx' });
  console.log('Renderer export passed');
} catch (error) {
  console.error(error.message);
  // Only renderer diagnostics: exportPptx forwards no provider credentials.
  if (error.stdout) console.error(error.stdout);
  if (error.stderr) console.error(error.stderr);
  process.exitCode = 1;
}
