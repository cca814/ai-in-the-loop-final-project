import { readFile, writeFile } from 'node:fs/promises';
import { reportToSlides } from './convert.js';
import { planPresentation } from './presentation-plan.js';
import { createClient } from '../report-agent/llm.js';

try {
  const [input, output, option, transition] = process.argv.slice(2);
  const automatic = option === '--ai' && process.argv.length === 5;
  if (!input || !output || (!automatic && process.argv.length !== 4 && (process.argv.length !== 6 || option !== '--transition' || !transition))) throw new Error('Usage: node cli.js <report.md> <slides.md> [--ai | --transition <name>]');
  const report = (await readFile(input, 'utf8')).replace(/^\uFEFF/, '');
  const presentationPlan = automatic ? await planPresentation(report, { complete: createClient() }) : undefined;
  await writeFile(output, reportToSlides(report, { transition, presentationPlan }), { encoding: 'utf8', flag: 'wx' });
  console.log(`Slides written to ${output}`);
} catch (error) {
  console.error(error.code === 'SLIDE_PLAN_INVALID' ? 'Model returned an invalid presentation plan; no output was written.' : error.message);
  process.exitCode = 1;
}
