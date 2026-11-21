import test from 'node:test';
import assert from 'node:assert/strict';
import { reportToSlides } from './convert.js';

test('preserves report content and links, and moves notes to Slidev comments', () => {
  const report = '# First\n\n- Fact\n\n## Speaker Notes\n\nA note.\n\n## Sources\n\n- [PR](https://example.com/pr/1)\n\n---\n\n# Second\n\n- Other\n\n## Speaker Notes\n\nAnother note.\n\n## Sources\n\n- [Doc](https://example.com/doc)\n';
  const slides = reportToSlides(report);
  assert.match(slides, /^---\ntheme: default\n---/);
  for (const text of ['# First', '- Fact', '- [PR](https://example.com/pr/1)', '<!--\nA note.\n-->', '# Second', '<!--\nAnother note.\n-->']) assert.ok(slides.includes(text));
  assert.ok(slides.includes('- [PR](https://example.com/pr/1) — https://example.com/pr/1'));
  assert.equal((slides.match(/^---$/gm) || []).length, 3);
});

test('rejects unsupported and ambiguous content instead of silently losing it', () => {
  assert.throws(() => reportToSlides('# Test\n```\n---\n```'), /Code fences/);
  assert.throws(() => reportToSlides('# Test\n\n- Missing notes'), /Speaker Notes/);
  assert.throws(() => reportToSlides('# T\n\n## Speaker Notes\n\nUnsafe --> text\n\n## Sources\n\n- [A](https://a.example)'), /invalid speaker notes/);
});

test('supports built-in transition choices and rejects unexpected settings', () => {
  const report = '# T\n\n## Speaker Notes\n\nNote\n\n## Sources\n\n- [A](https://a.example)';
  for (const transition of ['fade', 'fade-out', 'slide-left', 'slide-right', 'slide-up', 'slide-down']) assert.ok(reportToSlides(report, { transition }).includes(`transition: ${transition}\n`));
  assert.throws(() => reportToSlides(report, { transition: 'unexpected' }), /Unsupported transition/);
});

test('preserves translated report text while recognizing Chinese section headings', () => {
  for (const notes of ['講者備忘', '講者備註', '講者筆記', '講稿']) {
    for (const sources of ['來源', '來源連結', '參考來源', '參考資料']) {
      const report = `# 專案概述\n\n- 專案名稱：Demo App\n\n## ${notes}\n\n這是中文講稿。\n\n## ${sources}\n\n- [路線圖](https://example.com/roadmap)`;
      const slides = reportToSlides(report);
      assert.ok(slides.includes('# 專案概述'));
      assert.ok(slides.includes('<!--\n這是中文講稿。\n-->'));
      assert.ok(slides.includes(`## ${sources}`));
      assert.ok(slides.includes('[路線圖](https://example.com/roadmap)'));
    }
  }
});

test('supports mixed-language pages and rejects ambiguous duplicate headings', () => {
  const report = '# T\n\n## Speaker Notes\n\nNote\n\n## 來源\n\n- [A](https://a.example)';
  assert.ok(reportToSlides(report).includes('<!--\nNote\n-->'));
  assert.throws(() => reportToSlides(report.replace('Note\n\n', 'Note\n\n## 講者備忘\n\nExtra\n\n')), /needs one Speaker Notes/);
});


test('allows optional Sources and restores missing separators without changing notes', () => {
  const report = '# Summary\n\n- Result\n\n## Speaker Notes\n\nFirst note.\n\n# Details\n\n- Detail\n\n## 講稿\n\nSecond note.\n\n## Sources\n\n- [PR](https://example.com/pr)';
  const slides = reportToSlides(report);
  assert.equal((slides.match(/<!--/g) || []).length, 2);
  assert.equal((slides.match(/## Sources/g) || []).length, 1);
  assert.match(slides, /First note\.\n-->/);
  assert.match(slides, /Second note\.\n-->/);
  assert.match(slides, /---\n\n# Details/);
  assert.match(slides, /https:\/\/example.com\/pr/);
});
