import { readFile, writeFile } from 'node:fs/promises';
import { generateReport } from './index.js';
import { createClient } from './llm.js';

try {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || process.argv.length !== 4) throw new Error('Usage: node cli.js <state.json> <report.md>');
  const state = JSON.parse((await readFile(input, 'utf8')).replace(/^\uFEFF/, ''));
  const report = await generateReport(state, { complete: createClient() });
  await writeFile(output, report, { encoding: 'utf8', flag: 'wx' });
  console.log(`Report written to ${output}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
