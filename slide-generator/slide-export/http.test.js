import test from 'node:test';
import assert from 'node:assert/strict';
import { slideHandler } from './http.js';

const report = '# Overview\n\n- A fact\n\n## Speaker Notes\n\nA note.\n\n## Sources\n\n- [Source](https://example.com/source)';
const request = body => new Request('http://localhost:3000/api/reports/slides', { method: 'POST', body: JSON.stringify(body) });

test('slide endpoint preserves report text, sources and transition', async () => {
  const response = await slideHandler('slides', { production: false })(request({ report, transition: 'fade' }));
  assert.equal(response.status, 200);
  const { slides } = await response.json();
  assert.ok(slides.includes('transition: fade'));
  assert.ok(slides.includes('https://example.com/source'));
  assert.ok(slides.includes('<!--\nA note.\n-->'));
});

test('export endpoint returns binary PPTX using the selected format', async () => {
  const response = await slideHandler('export', { production: false, render: async (slides, options) => {
    assert.equal(options.format, 'pptx-editable');
    assert.ok(slides.includes('- A fact'));
    return Buffer.from('PK-test');
  } })(request({ report, format: 'pptx-editable' }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /presentationml/);
  assert.equal(await response.text(), 'PK-test');
});

test('rejects production, invalid report, executable markup and unexpected formats', async () => {
  assert.equal((await slideHandler('slides', { production: true })(request({ report }))).status, 403);
  for (const body of [{ report: 'No sections' }, { report, format: '../bad' }, { report: report + '\n<script>bad</script>' }]) {
    assert.equal((await slideHandler('export', { production: false })(request(body))).status, 400);
  }
});

test('export failures return a useful error without internal process output', async () => {
  const response = await slideHandler('export', { production: false, render: async () => { throw new Error('internal-secret-path'); } })(request({ report }));
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes('internal-secret-path'));
});

test('translated report passes the web endpoint without rewriting its contents', async () => {
  const translated = '# 專案概述\n\n- 專案名稱：Demo App\n\n## 講者備忘\n\n這是中文講稿。\n\n## 來源\n\n- [路線圖](https://example.com/roadmap)';
  const response = await slideHandler('slides', { production: false })(request({ report: translated }));
  assert.equal(response.status, 200);
  const { slides } = await response.json();
  assert.ok(slides.includes('這是中文講稿。'));
  assert.ok(slides.includes('## 來源'));
});

test('format errors identify the affected page rather than blaming all formatting', async () => {
  const response = await slideHandler('slides', { production: false })(request({ report: report + '\n\n---\n\n# 第二頁\n\n缺少區塊' }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /第 2 頁/);
});

test('web endpoint builds the converted draft and returns a playback URL', async () => {
  const response = await slideHandler('web', { production: false, buildWeb: async slides => {
    assert.ok(slides.includes('transition: fade'));
    return { url: '/api/reports/present/00000000-0000-4000-8000-000000000000/', expiresAt: '2026-11-21T00:00:00Z' };
  } })(request({ report, transition: 'fade' }));
  assert.equal(response.status, 200);
  assert.match((await response.json()).url, /^\/api\/reports\/present\//);
});

test('portable endpoint returns a ZIP with converted report and selected transition', async () => {
  const response = await slideHandler('portable', { production: false, archive: async slides => {
    assert.match(slides, /transition: fade/);
    assert.match(slides, /https:\/\/example.com\/source/);
    return Buffer.from('PK-archive');
  } })(request({ report, transition: 'fade' }));
  assert.equal(response.headers.get('content-type'), 'application/zip');
  assert.match(response.headers.get('content-disposition'), /\.zip/);
  assert.equal(await response.text(), 'PK-archive');
});
