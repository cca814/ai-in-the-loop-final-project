// Browser-only synthetic data injection. No demo data is imported by the app.
import { readFile } from 'node:fs/promises';
export async function openTestWorkspace(page, base) {
  const snapshots = await Promise.all([['normal', '一般進度', 'normal'], ['missingRisks', '缺少風險評估', 'missing_risks'], ['featureDone', '功能完成', 'feature_done']].map(async ([id, label, file]) => ({ id, label, state: JSON.parse(await readFile(new URL(`../schemas/examples/${file}.json`, import.meta.url))) })));
  await page.route('**/api/reports/history', route => route.fulfill({ json: { dataset: { id: 'demo', replayId: 'repo-test-only', label: '模擬專案', snapshots } } }));
  await page.goto(`${base}/reports`, { waitUntil: 'networkidle' });
  await page.getByLabel('公開 GitHub repo 網址', { exact: true }).fill('https://github.com/example/demo-app');
  await page.getByRole('button', { name: '載入已重建的歷史 State', exact: true }).click();
  await page.getByLabel('直接編輯 Markdown').waitFor();
  await page.locator('#state-history > summary').click();
  await page.getByLabel('選擇歷史版本', { exact: true }).selectOption('normal');
}
