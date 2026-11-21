import { chromium } from 'playwright-chromium';
import { spawn } from 'node:child_process';

const server = spawn(process.execPath, ['node_modules/@slidev/cli/bin/slidev.mjs', 'animations-fixture.md', '--port', '39461'], { stdio: ['pipe', 'ignore', 'ignore'] });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  let connected = false;
  for (let i = 0; i < 40; i++) {
    try { await page.goto('http://localhost:39461/1', { waitUntil: 'networkidle', timeout: 5000 }); connected = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  if (!connected) throw new Error('Slidev server did not start');
  await page.evaluate(() => {
    window.transitionClasses = [];
    new MutationObserver(records => {
      for (const record of records) {
        const names = record.target.classList;
        if (names) for (const name of names) if (/^(fade|slide-left)-(enter|leave)/.test(name)) window.transitionClasses.push(name);
      }
    }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  const first = page.getByText('First point', { exact: true });
  const hiddenBefore = await first.evaluate(el => el.classList.contains('slidev-vclick-hidden'));
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(600);
  const hiddenAfter = await first.evaluate(el => el.classList.contains('slidev-vclick-hidden'));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(600);
  const secondPage = await page.getByRole('heading', { name: 'Second slide' }).count();
  if (!hiddenBefore || hiddenAfter || !secondPage) throw new Error('Click reveal or navigation did not work');
  const classes = await page.evaluate(() => window.transitionClasses);
  if (!classes.length) throw new Error('No expected transition classes observed');
  console.log(`Browser: click reveal, navigation and transition classes passed (${[...new Set(classes)].join(', ')})`);
} finally {
  await browser.close();
  server.kill();
}
