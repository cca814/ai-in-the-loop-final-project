import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reviseReport } from './revision.js';
import { createClient } from './llm.js';
import { parseReport } from './report-format.js';
import { wantsPlainLanguageRewrite } from './revision-validation.js';
import { reportHandler } from './http.js';

const state = JSON.parse(readFileSync(new URL('../schemas/examples/normal.json', import.meta.url), 'utf8'));
const reply = result => async () => JSON.stringify(result);

const page = (title, text) => `# ${title}\n\n- ${text}\n\n## Speaker Notes\n\n${text}`;

test('non-technical rewrite corrects a no-op without changing facts, citations or unrelated pages', async () => {
  const technical = page('核心能力', '以 Promise 佇列控制 concurrency。');
  const other = page('其他資訊', '保持原稿。');
  const report = `${technical}\n\n## Sources\n\n- [來源](${state.repository.url})\n\n---\n\n${other}`;
  const originalState = structuredClone(state);
  let calls = 0;
  const result = await reviseReport({ state, report, request: '只改核心能力：報告對象沒有這方面的專業知識，很多術語或概念不懂，要就是說明或是避開' }, { complete: async messages => {
    calls++;
    assert.match(messages[0].content, /preserving facts from preserving wording/);
    assert.match(messages[0].content, /language of the current user request/);
    assert.equal(JSON.parse(messages[1].content).current_report, report);
    if (calls === 1) return JSON.stringify({ changes: [], message: 'No changes needed; technical facts must stay.' });
    assert.equal(JSON.parse(messages.at(-1).content).correction_required, 'REVISION_NO_EFFECT');
    return JSON.stringify({ changes: [{ old: technical, new: page('核心能力', '讓工作依序等待，並限制同時執行的數量。') }], message: '已將術語換成白話，保留原意。' });
  } });
  assert.equal(calls, 2); assert.equal(result.changed, true);
  assert.ok(result.report.endsWith(other)); assert.ok(result.report.includes(state.repository.url));
  assert.deepEqual(state, originalState);
});

test('audience rewrites reject empty, identical and whitespace-only edits, including after correction', async () => {
  const report = page('能力', '以 Promise 佇列限制同時執行。');
  for (const changes of [[], [{ old: report, new: report }], [{ old: report, new: report.replace('- 以', '-  以') }]]) {
    let calls = 0;
    await assert.rejects(() => reviseReport({ state, report, request: '改成白話，讓非技術人士理解' }, { complete: async () => { calls++; return JSON.stringify({ changes, message: 'Already adapted.' }); } }), { code: 'REVISION_NO_EFFECT' });
    assert.equal(calls, 2);
  }
});

test('plain-language intent is narrow and other legitimate no-op requests remain allowed', async () => {
  for (const request of ['Explain jargon for a non-technical audience', '避開術語，讓一般人看懂', '改成白話']) assert.equal(wantsPlainLanguageRewrite(request), true);
  for (const request of ['保留術語', '不要修改，保留原稿', '不用改寫成白話', 'List technical sources']) assert.equal(wantsPlainLanguageRewrite(request), false);
  const result = await reviseReport({ state, report: page('現況', '原有內容。'), request: '不用修改，保留原稿' }, { complete: reply({ changes: [], message: '已保留。' }) });
  assert.equal(result.changed, false);
});

test('persistent audience no-op is reported as a failed revision rather than success', async () => {
  const response = await reportHandler('revise', { production: false, complete: reply({ changes: [], message: 'No changes needed.' }) })(new Request('http://localhost/api/reports/revise', { method: 'POST', body: JSON.stringify({ state, report: page('能力', 'Promise 佇列。'), request: '改成白話', history: [], useRepository: false }) }));
  const body = await response.json();
  assert.equal(response.status, 502); assert.equal(body.code, 'REVISION_NO_EFFECT');
  assert.match(body.error, /未實際改寫/); assert.equal(body.report, undefined);
  assert.equal(body.operation.modelCalls, 2);
});

test('adding a page without notes triggers correction against original draft and preserves manual text', async () => {
  const first = page('Summary', 'Manual wording stays.');
  const last = page('Details', 'Existing detail.');
  const report = `${first}\n\n---\n\n${last}`;
  let calls = 0;
  const result = await reviseReport({ state, report, request: 'Split Details into two pages' }, { complete: async messages => {
    calls++;
    assert.equal(JSON.parse(messages[1].content).current_report, report);
    if (calls === 1) return JSON.stringify({ changes: [{ old: last, new: `${last}\n\n# Extra\n\n- Existing detail.` }], message: 'Split.' });
    const correction = JSON.parse(messages.at(-1).content);
    assert.equal(correction.correction_required, 'REVISION_STRUCTURE_INVALID');
    assert.match(correction.detail, /3/);
    return JSON.stringify({ changes: [{ old: last, new: `${last}\n\n${page('Extra', 'Existing detail.')}` }], message: 'Split with notes.' });
  } });
  assert.equal(calls, 2);
  assert.ok(result.report.startsWith(first));
  assert.equal(parseReport(result.report).length, 3);
  assert.match(result.report, /---\n\n# Extra/);
  assert.ok(!result.report.includes('## Sources'));
});

test('merging pages keeps one script and rejects persistent missing or duplicate notes', async () => {
  const report = `${page('One', 'First fact.')}\n\n---\n\n${page('Two', 'Second fact.')}`;
  const merged = page('Combined', 'First fact. Second fact.');
  const result = await reviseReport({ state, report, request: 'Merge into one page' }, { complete: reply({ changes: [{ old: report, new: merged }], message: 'Merged.' }) });
  assert.equal(parseReport(result.report).length, 1);
  for (const invalid of ['# Combined\n\n- First fact.', `${merged}\n\n## Speaker Notes\nDuplicate.`, 'All headings removed']) {
    let calls = 0;
    await assert.rejects(reviseReport({ state, report, request: 'Merge pages' }, { complete: async () => {
      calls++;
      return JSON.stringify({ changes: [{ old: report, new: invalid }], message: 'Merged.' });
    } }), error => error.code === 'REVISION_STRUCTURE_INVALID');
    assert.equal(calls, 2);
    assert.equal(parseReport(report).length, 2);
  }
});

test('edits the latest manually edited report and passes context without changing state', async () => {
  const original = structuredClone(state);
  const report = '# Overview\nManual edit\n\n## Speaker Notes\nOverview note.\n\n---\n\n# Other\nKeep this.\n\n## Speaker Notes\nOther note.\n';
  const history = [{ role: 'user', content: 'Make it shorter' }, { role: 'assistant', content: 'Done' }];
  const result = await reviseReport({ state, report, request: 'Change Manual edit to Edited', history }, { complete: async messages => {
    const input = JSON.parse(messages[1].content);
    assert.equal(input.current_report, report);
    assert.deepEqual(input.conversation_history, history);
    return JSON.stringify({ changes: [{ old: 'Manual edit', new: 'Edited' }], message: 'Changed.' });
  } });
  assert.equal(result.report, report.replace('Manual edit', 'Edited'));
  assert.deepEqual(state, original);
});

test('rejects ambiguous and overlapping edits', async () => {
  const args = { state, report: 'same same unique', request: 'edit' };
  await assert.rejects(reviseReport(args, { complete: reply({ changes: [{ old: 'same', new: 'x' }], message: '' }) }), /exactly once/);
  await assert.rejects(reviseReport(args, { complete: reply({ changes: [{ old: 'same same', new: 'x' }, { old: 'same unique', new: 'y' }], message: '' }) }), /Overlapping/);
});

test('supports multiple turns and a clarification without changing the report', async () => {
  const first = await reviseReport({ state, report: 'A B', request: 'Change A' }, { complete: reply({ changes: [{ old: 'A', new: 'C' }], message: 'Done' }) });
  const second = await reviseReport({ state, report: first.report, request: 'Use an unsupported deadline', history: [{ role: 'user', content: 'Change A' }, { role: 'assistant', content: 'Done' }] }, { complete: reply({ changes: [], message: 'No deadline evidence.' }) });
  assert.equal(second.report, 'C B');
  assert.equal(second.message, 'No deadline evidence.');
});

test('two Gemini turns keep manual edits and forward history through the provider', async () => {
  let calls = 0;
  const complete = createClient({ provider: 'gemini', apiKey: 'fake-key', model: 'test-model', fetchImpl: async (_url, options) => {
    const body = JSON.parse(options.body);
    const context = JSON.parse(body.contents[0].parts[0].text);
    calls++;
    if (calls === 1) {
      assert.equal(context.current_report, '# Notes\nOriginal\n\n## Speaker Notes\nFirst note.\n\n---\n\n# Other\nKeep\n\n## Speaker Notes\nSecond note.\n');
      assert.deepEqual(context.conversation_history, []);
      return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ changes: [{ old: 'Original', new: 'Shorter' }], message: 'Shortened.' }) }] } }] }) };
    }
    assert.equal(context.current_report, '# Notes\nShorter\n\n## Speaker Notes\nFirst note.\n\n---\n\n# Other\nManual edit\n\n## Speaker Notes\nSecond note.\n');
    assert.deepEqual(context.conversation_history, [{ role: 'user', content: 'Shorten notes' }, { role: 'assistant', content: 'Shortened.' }]);
    return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ changes: [{ old: 'Shorter', new: 'Concise' }], message: 'Reworded.' }) }] } }] }) };
  } });
  const first = await reviseReport({ state, report: '# Notes\nOriginal\n\n## Speaker Notes\nFirst note.\n\n---\n\n# Other\nKeep\n\n## Speaker Notes\nSecond note.\n', request: 'Shorten notes' }, { complete });
  const manualReport = first.report.replace('Keep', 'Manual edit');
  const second = await reviseReport({ state, report: manualReport, request: 'Reword the previous edit', history: [{ role: 'user', content: 'Shorten notes' }, { role: 'assistant', content: first.message }] }, { complete });
  assert.equal(second.report, '# Notes\nConcise\n\n## Speaker Notes\nFirst note.\n\n---\n\n# Other\nManual edit\n\n## Speaker Notes\nSecond note.\n');
  assert.equal(calls, 2);
});

test('whole-report translation rejects a false already-translated response and corrects once', async () => {
  const report = '# Project Overview\n\n- The project is using a queue.\n\n## Speaker Notes\n\n這是中文講稿。\n\n## Sources\n\n- [Source](https://example.com/source)';
  const translated = '# 專案概述\n\n- 此專案使用佇列。\n\n## 講者備忘\n\n這是中文講稿。\n\n## 來源\n\n- [Source](https://example.com/source)';
  let calls = 0;
  const result = await reviseReport({ state, report, request: '報告內容翻譯成繁體中文' }, { complete: async messages => {
    calls++;
    if (calls === 1) return JSON.stringify({ changes: [], message: 'Already in Traditional Chinese.' });
    assert.equal(JSON.parse(messages.at(-1).content).correction_required, 'REVISION_TRANSLATION_INCOMPLETE');
    assert.equal(JSON.parse(messages[1].content).current_report, report);
    return JSON.stringify({ changes: [{ old: report, new: translated }], message: '已翻譯標題、重點及講稿。' });
  } });
  assert.equal(calls, 2);
  assert.equal(result.report, translated);
  assert.equal(result.changed, true);
});

test('partial translation cannot pass by translating only titles and notes', async () => {
  const report = '# 專案概述\n\n- The latest recorded merge is pull request 109.\n\n## 講稿\n\n中文講稿。';
  let calls = 0;
  await assert.rejects(reviseReport({ state, report, request: '翻譯成繁體中文' }, { complete: async () => {
    calls++;
    return JSON.stringify({ changes: [], message: 'Already translated.' });
  } }), error => error.code === 'REVISION_TRANSLATION_INCOMPLETE');
  assert.equal(calls, 2);
});

test('notes-only translation can leave English page titles unchanged', async () => {
  const report = '# Project Overview\n\n- Keep English bullets\n\n## Speaker Notes\n\nOriginal note.';
  const result = await reviseReport({ state, report, request: '僅將講稿翻譯成繁體中文' }, { complete: reply({ changes: [{ old: 'Original note.', new: '中文講稿。' }], message: 'Updated notes.' }) });
  assert.match(result.report, /# Project Overview/);
  assert.match(result.report, /中文講稿/);
});

test('exact-match correction uses the original report, and provider errors are not resent', async () => {
  let calls = 0;
  const result = await reviseReport({ state, report: 'Original\nManual', request: 'Reword' }, { complete: async messages => {
    calls++;
    if (calls === 1) return JSON.stringify({ changes: [{ old: 'Absent text', new: 'Oops' }], message: 'Changed' });
    assert.equal(JSON.parse(messages.at(-1).content).correction_required, 'REVISION_MATCH_FAILED');
    return JSON.stringify({ changes: [{ old: 'Original', new: 'Updated' }], message: 'Changed' });
  } });
  assert.equal(result.report, 'Updated\nManual');
  assert.equal(calls, 2);
  let networkCalls = 0;
  await assert.rejects(reviseReport({ state, report: 'Original', request: 'Reword' }, { complete: async () => { networkCalls++; throw new Error('Network failure'); } }), /Network failure/);
  assert.equal(networkCalls, 1);
});

test('directory-per-page revisions receive normalized requirements up front without a false one-page limit', async () => {
  const report = `${page('原架構', '既有說明。')}\n\n---\n\n${page('現況', '既有狀況。')}`;
  const context = { repository: state.repository.full_name, commit: state.source_commit_sha, files: [], inventory: { source_id: 'repo-tree', directories: ['.github', '.github/workflows', 'scripts'], complete: true, url: `${state.repository.url}/tree/${state.source_commit_sha}` } };
  const replacement = ['.github', '.github/workflows', 'scripts'].map(path => page(path, '此資料夾存在；尚未提供足夠內容判斷用途。')).join('\n\n---\n\n');
  const result = await reviseReport({ state, report, request: '介紹實際資料夾，一個資料夾一頁' }, { repositoryContext: context, complete: async messages => {
    const payload = JSON.parse(messages[1].content);
    assert.equal(payload.current_page_count, 2);
    assert.deepEqual(payload.requirements, { pagesPerDirectory: 1 });
    assert.deepEqual(payload.repository_context.inventory.directories, context.inventory.directories);
    return JSON.stringify({ changes: [{ old: report, new: replacement }], message: '依實際目錄分頁；用途仍待證據。' });
  } });
  assert.equal(parseReport(result.report).length, 3);
  assert.equal(result.report, replacement);
});

test('revision page-count errors report expected and actual counts without exposing raw model output', async () => {
  const report = `${page('第一頁', '原稿。')}\n\n---\n\n${page('第二頁', '原稿。')}`;
  const response = await reportHandler('revise', { production: false, complete: async () => JSON.stringify({ changes: [], message: 'Not applied' }) })(new Request('http://localhost/api/reports/revise', { method: 'POST', body: JSON.stringify({ state, report, request: '整份報告改成一頁', history: [] }) }));
  assert.equal(response.status, 502);
  const result = await response.json();
  assert.equal(result.code, 'REVISION_REQUIREMENT_INVALID');
  assert.match(result.error, /要求整份報告 1 頁，修改結果為 2 頁/);
});
