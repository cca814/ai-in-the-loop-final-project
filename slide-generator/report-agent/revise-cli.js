import { readFile, writeFile } from 'node:fs/promises';
import { createClient } from './llm.js';
import { reviseReport } from './revision.js';

try {
  const [statePath, reportPath, outputPath, request, historyPath] = process.argv.slice(2);
  if (!statePath || !reportPath || !outputPath || !request || process.argv.length > 7) throw new Error('Usage: node revise-cli.js <state.json> <current-report.md> <output.md> <request> [history.json]');
  const readText = async path => (await readFile(path, 'utf8')).replace(/^\uFEFF/, '');
  const state = JSON.parse(await readText(statePath));
  const report = await readText(reportPath);
  const history = historyPath ? JSON.parse(await readText(historyPath)) : [];
  const result = await reviseReport({ state, report, request, history }, { complete: createClient() });
  await writeFile(outputPath, result.report, { encoding: 'utf8', flag: 'wx' });
  console.log(`Report written to ${outputPath}`);
  console.log(result.message);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
