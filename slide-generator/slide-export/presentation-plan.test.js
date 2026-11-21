import test from 'node:test';
import assert from 'node:assert/strict';
import { planPresentation, validatePresentationPlan } from './presentation-plan.js';
import { reportToSlides } from './convert.js';
import { slideHandler } from './http.js';
import { ProviderError } from '../report-agent/errors.js';

const report = '# Summary\n\n- Original fact\n- Manual wording\n\n## Speaker Notes\n\nExact speaker notes.\n\n---\n\n# Details\n\n- Other fact\n\n## 講稿\n\n原本的講稿。\n\n## Sources\n\n- [PR](https://example.com/pr)';
const effect = { transition: 'fade', layout: 'default', reveal: true, clickAnimation: 'up' };
const plan = { pages: [effect, { ...effect, transition: 'slide-left', reveal: false, layout: 'center' }] };
const request = body => new Request('http://localhost:3000/api/reports/slides', { method: 'POST', body: JSON.stringify(body) });

test('model selects per-page effects while converter keeps confirmed wording, notes, citations and order', async () => {
  const selected = await planPresentation(report, { complete: async messages => {
    const input = JSON.parse(messages[1].content);
    assert.equal(input.pages.length, 2);
    assert.match(input.pages[0].content, /Manual wording/);
    assert.equal(input.pages[0].speaker_notes, 'Exact speaker notes.');
    assert.match(messages[0].content, /untrusted data/);
    return JSON.stringify(plan);
  } });
  const slides = reportToSlides(report, { presentationPlan: selected });
  assert.match(slides, /theme: default\nlayout: default\ntransition: fade\nclickAnimation: up\n---/);
  assert.match(slides, /---\nlayout: center\ntransition: slide-left\nclickAnimation: up\n---\n\n# Details/);
  assert.match(slides, /<v-clicks>\n\n- Original fact\n- Manual wording\n\n<\/v-clicks>/);
  assert.match(slides, /<!--\nExact speaker notes\.\n-->/);
  assert.match(slides, /<!--\n原本的講稿。\n-->/);
  assert.ok(slides.includes('- [PR](https://example.com/pr)'));
  assert.equal((slides.match(/<v-clicks>/g) || []).length, 1);
  assert.ok(slides.indexOf('Original fact') < slides.indexOf('Other fact'));
});

test('rejects invalid counts, executable settings, extra text and wrong field types', () => {
  for (const invalid of [null, {}, { pages: [] }, { ...plan, script: '<script/>' }, { pages: [{ ...effect, transition: 'fade\nsrc: ./private' }, effect] }, { pages: [{ ...effect, layout: 'iframe' }, effect] }, { pages: [{ ...effect, reveal: 'true' }, effect] }, { pages: [{ ...effect, clickAnimation: 'custom' }, effect] }, { pages: [{ ...effect, html: '<script>bad</script>' }, effect] }]) {
    assert.throws(() => validatePresentationPlan(invalid, 2), error => error.code === 'SLIDE_PLAN_INVALID');
  }
  assert.throws(() => reportToSlides(report, { presentationPlan: plan, transition: 'fade' }));
});

test('repairs invalid JSON once without accepting content changes and does not resend provider failures', async () => {
  let calls = 0;
  assert.deepEqual(await planPresentation(report, { complete: async messages => {
    calls++;
    if (calls === 1) return JSON.stringify({ pages: [{ ...effect, content: 'Invented progress' }] });
    assert.match(messages.at(-1).content, /exactly 2 pages/);
    return JSON.stringify(plan);
  } }), plan);
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(planPresentation(report, { complete: async () => { calls++; return 'not JSON'; } }), error => error.code === 'SLIDE_PLAN_INVALID');
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(planPresentation(report, { complete: async () => { calls++; throw new ProviderError(503); } }), ProviderError);
  assert.equal(calls, 1);
});

test('slides API plans once; all three output forms reuse byte-identical Slidev source without a model call', async () => {
  let calls = 0;
  const response = await slideHandler('slides', { production: false, complete: async () => { calls++; return JSON.stringify(plan); } })(request({ report, transition: 'auto' }));
  assert.equal(response.status, 200);
  const draft = await response.json();
  assert.deepEqual(draft.presentationPlan, plan);
  for (const mode of ['web', 'export', 'portable']) {
    const validate = async slides => {
      assert.equal(slides, draft.slides);
      return mode === 'web' ? { url: '/api/reports/present/test/' } : Buffer.from('PK-test');
    };
    const result = await slideHandler(mode, { production: false, complete: async () => { throw new Error('Must never call'); }, buildWeb: validate, render: validate, archive: validate })(request({ report, transition: 'auto', presentationPlan: draft.presentationPlan }));
    assert.equal(result.status, 200);
    assert.equal((await slideHandler(mode, { production: false })(request({ report, transition: 'auto' }))).status, 400);
  }
  assert.equal(calls, 1);
});

test('rejects invalid requests before model calls and hides failures without changing the report', async () => {
  let calls = 0;
  const handler = slideHandler('slides', { production: false, complete: async () => { calls++; throw new Error('secret-provider-details'); } });
  for (const body of [{ report: 'Missing structure', transition: 'auto' }, { report: report + '<script/>', transition: 'auto' }, { report, transition: 'auto', presentationPlan: {} }]) assert.equal((await handler(request(body))).status, 400);
  assert.equal(calls, 0);
  const failure = await handler(request({ report, transition: 'auto' }));
  assert.equal(failure.status, 502);
  const text = await failure.text();
  assert.ok(!text.includes('secret-provider-details'));
  assert.match(text, /SLIDE_PLANNING_FAILED/);
  assert.equal(calls, 1);
  assert.equal((await handler(request({ report, transition: 'fade' }))).status, 200);
  assert.equal(calls, 1);
});
