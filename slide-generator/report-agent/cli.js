import { readFile, writeFile } from 'node:fs/promises';
import { generateReport } from './index.js';
import { createClient } from './llm.js';

try {
  const [input, output, focus = ''] = process.argv.slice(2);
  if (!input || !output || process.argv.length > 5) throw new Error('Usage: node cli.js <state.json> <report.md> [generation-request]');
  const state = JSON.parse((await readFile(input, 'utf8')).replace(/^\uFEFF/, ''));
  const report = await generateReport(state, { complete: createClient(), focus });
  await writeFile(output, report, { encoding: 'utf8', flag: 'wx' });
  console.log(`Report written to ${output}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
