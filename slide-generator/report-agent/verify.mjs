// Unified checks. Never loads .env.local or invokes an unmocked model client.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const flags = new Set(process.argv.slice(2));
if ([...flags].some(flag => !['--browser', '--render'].includes(flag))) throw new Error('Usage: node report-agent/verify.mjs [--browser] [--render]');
const env = { ...process.env, NODE_ENV: 'test', REPORT_TEST_URL: process.env.REPORT_TEST_URL || 'http://localhost:3000', PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || join(root, 'slide-export/node_modules/.playwright-browsers') };
const checks = [
  ['Agent tests', ['--test', '--test-reporter=dot'], join(root, 'report-agent')],
  ['Slide export tests', ['--test', '--test-reporter=dot'], join(root, 'slide-export')],
  ['Historical fixture tests', ['--test', '--test-reporter=dot'], join(root, 'test-data/p-limit')],
  ['Lint', ['node_modules/eslint/bin/eslint.js']],
  ['TypeScript', ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false']],
];
if (flags.has('--browser') || flags.has('--render')) checks.push(
  ['Workspace browser', ['report-agent/web-check.mjs']],
  ['Review and cancellation browser', ['report-agent/optimizations-browser-check.mjs']],
  ['Public repository browser', ['report-agent/public-repository-browser-check.mjs']],
  ['Compiled historical routes', ['report-agent/repository-next-check.mjs']],
);
if (flags.has('--render')) checks.push(['Actual Slidev builds and exports', ['slide-export/auto-effects-browser-check.mjs']]);
for (const [name, args, cwd = root] of checks) {
  process.stdout.write(`\n${name}\n`);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject); child.once('exit', resolve);
  });
  if (code !== 0) { process.exitCode = 1; break; }
  process.stdout.write(`${name}: PASS\n`);
}
