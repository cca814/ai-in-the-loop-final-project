import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { retrieveRepositoryContext, loadHistoricalRepository, repositorySources } from './repository-context.js';
import { generateReport } from './index.js';
import { reviseReport } from './revision.js';
import { reportHandler } from './http.js';
import { historicalArchiveUrls } from './repository-archives.js';
import { ProviderError } from './errors.js';

const root = new URL('../test-data/p-limit/', import.meta.url);
const inventory = JSON.parse(await readFile(new URL('inventory.json', root)));
const state = JSON.parse(await readFile(new URL('states/021-pr-109.json', root)));
const json = value => JSON.stringify(value);
const plan = files => json({ files, reason: files.length ? 'Inspect the implementation.' : 'Wording only.' });
const range = { path: 'index.js', start_line: 118, end_line: 130 };
const pages = source => ({ pages: ['Project Overview', 'Feature Progress', 'Recent Changes', 'Risks and Issues'].map(title => ({ title, bullets: ['Review the supplied evidence.'], script: 'Explain implementation without changing snapshot statuses.', source_ids: [source] })) });
const request = body => new Request('http://localhost:3000/api/reports/generate', { method: 'POST', body: json(body) });

test('invalid selection is corrected once using exact commit, file bounds and the original task', async () => {
  const original = structuredClone(state);
  const history = [{ role: 'user', content: 'Earlier wording request' }];
  for (const [invalid, issue] of [
    ['not JSON', 'SELECTION_JSON_INVALID'],
    [plan([{ ...range, path: '../index.js' }]), 'SELECTION_PATH_INVALID'],
    [plan([{ path: 'index.js', start_line: 1, end_line: 1000 }]), 'SELECTION_RANGE_INVALID'],
    [plan(Array(5).fill(range)), 'SELECTION_FORMAT_INVALID'],
    [plan([range, range]), 'SELECTION_DUPLICATE_RANGE'],
    [plan([{ ...range, start_line: '118' }]), 'SELECTION_RANGE_INVALID'],
  ]) {
    let calls = 0;
    const context = await retrieveRepositoryContext({ state, mode: 'revise', request: 'Explain clearQueue', report: 'Manually edited report', history }, { complete: async messages => {
      calls++;
      const input = JSON.parse(messages[1].content);
      assert.equal(input.commit, state.source_commit_sha);
      assert.equal(input.current_report_excerpt, 'Manually edited report');
      assert.deepEqual(input.conversation_history, history);
      if (calls === 1) return invalid;
      const correction = JSON.parse(messages.at(-1).content);
      assert.equal(correction.correction_required, issue);
      assert.equal(correction.limits.maximum_ranges, 4);
      assert.equal(correction.limits.maximum_lines_per_range, 180);
      assert.equal(correction.limits.maximum_total_characters, 24000);
      assert.ok(correction.available_files.every(file => Number.isInteger(file.lines) && !('content' in file)));
      return plan([range]);
    } });
    assert.equal(calls, 2);
    assert.equal(context.files[0].start_line, 118);
    assert.match(context.files[0].content, /clearQueue/);
    assert.deepEqual(state, original);
  }
});

test('planner does not resend provider or archive integrity errors and supports disabling correction', async () => {
  let calls = 0;
  await assert.rejects(retrieveRepositoryContext({ state, mode: 'generate' }, { complete: async () => { calls++; throw new ProviderError(503); } }), ProviderError);
  assert.equal(calls, 1);
  calls = 0;
  const snapshot = await loadHistoricalRepository(state);
  snapshot.files['index.js'].content += 'corrupted';
  await assert.rejects(retrieveRepositoryContext({ state, mode: 'generate' }, { loadSnapshot: async () => snapshot, complete: async () => { calls++; return plan([range]); } }), /integrity/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(retrieveRepositoryContext({ state, mode: 'generate' }, { maxCorrectionRetries: 0, complete: async () => { calls++; return 'bad JSON'; } }), error => error.code === 'SELECTION_JSON_INVALID' && error.correctionAttempts === 0);
  assert.equal(calls, 1);
});

test('full 21-merge report proceeds after selection correction and never writes after exhausted correction', async () => {
  const body = { state, useRepository: true, focus: '弄出整個專案歷史的完整報告', mergeRange: { startCommit: inventory.entries[0].source_commit_sha, endCommit: state.source_commit_sha } };
  let calls = 0;
  const response = await reportHandler('generate', { production: false, complete: async messages => {
    calls++;
    const input = JSON.parse(messages[1].content);
    if (input.available_files) {
      assert.equal(input.current_request, body.focus);
      return calls === 1 ? plan([{ path: 'index.js', start_line: 1, end_line: 1000 }]) : plan([range]);
    }
    assert.equal(input.merge_history.merges.length, 21);
    assert.equal(input.repository_context.files[0].start_line, 118);
    return json(pages('repo-file-1'));
  } })(request(body));
  assert.equal(response.status, 200);
  const output = await response.json();
  assert.equal(output.mergeRange.count, 21);
  assert.equal(output.repository.commit, state.source_commit_sha);
  assert.equal(calls, 3);
  calls = 0;
  const failed = await reportHandler('revise', { production: false, complete: async () => { calls++; return plan([{ ...range, path: '../secret.txt' }]); } })(request({ ...body, report: 'Keep manual wording.', request: 'Explain the history', history: [] }));
  const error = await failed.json();
  assert.equal(failed.status, 502);
  assert.equal(error.code, 'REPOSITORY_SELECTION_INVALID');
  assert.equal(error.selectionIssue, 'SELECTION_PATH_INVALID');
  assert.match(error.error, /修正一次/);
  assert.ok(!JSON.stringify(error).includes('secret.txt'));
  assert.equal(error.report, undefined);
  assert.equal(calls, 2);
});

test('all 21 repository archives resolve by exact State SHA, including the earliest version', async () => {
  assert.deepEqual(Object.keys(historicalArchiveUrls).sort(), inventory.entries.map(entry => entry.file).sort());
  for (const entry of inventory.entries) {
    const historical = JSON.parse(await readFile(new URL(`states/${entry.file}`, root)));
    const input = await loadHistoricalRepository(historical);
    assert.equal(input.commit.sha, historical.source_commit_sha);
    if (entry.pr === 1) {
      assert.ok(!input.files['index.d.ts']);
      assert.ok(!input.files['index.js'].content.includes('limitFunction'));
    }
  }
  await assert.rejects(loadHistoricalRepository({ ...state, source_commit_sha: 'a'.repeat(40) }), /Unknown snapshot/);
  await assert.rejects(loadHistoricalRepository({ ...state, source_commit_sha: '../bad' }), /Unsupported repository/);
  await assert.rejects(loadHistoricalRepository({ ...state, repository: { full_name: 'other/repo', url: 'https://github.com/other/repo' } }), /Unsupported repository/);
});

test('planner sees only State, task and file metadata; writer gets only selected verified lines', async () => {
  const original = structuredClone(state);
  let calls = 0;
  const context = await retrieveRepositoryContext({ state, mode: 'revise', request: 'Explain clearQueue', report: 'Current report' }, { complete: async messages => {
    calls++;
    const input = JSON.parse(messages[1].content);
    assert.deepEqual(input.state, state);
    assert.equal(input.commit, state.source_commit_sha);
    assert.equal(input.current_request, 'Explain clearQueue');
    assert.ok(input.available_files.some(file => file.path === 'index.js'));
    assert.ok(input.available_files.every(file => !('content' in file)));
    assert.match(messages[0].content, /untrusted data/);
    return plan([range]);
  } });
  assert.equal(calls, 1);
  assert.equal(context.files.length, 1);
  assert.match(context.files[0].content, /Object.defineProperty\(limitedFunction, 'clearQueue'/);
  assert.equal(context.files[0].content.split('\n').length, 13);
  assert.equal(context.files[0].url, `https://github.com/sindresorhus/p-limit/blob/${state.source_commit_sha}/index.js#L118-L130`);
  assert.equal(repositorySources(context, state)[0].id, 'repo-file-1');
  assert.deepEqual(state, original);
  await assert.rejects(generateReport(state, { complete: async messages => {
    const input = JSON.parse(messages[1].content);
    assert.deepEqual(input.state, state);
    assert.deepEqual(input.repository_context, context);
    assert.match(messages[0].content, /cannot establish a release/);
    return json(pages('invented-file'));
  }, repositoryContext: context }), /Unknown response source/);
  const report = await generateReport(state, { complete: async () => json(pages('repo-file-1')), repositoryContext: context });
  assert.ok(report.includes(context.files[0].url));
});

test('wording-only requests can select no files and preserve exact State and history', async () => {
  const context = await retrieveRepositoryContext({ state, mode: 'revise', request: 'Translate to Chinese' }, { complete: async () => plan([]) });
  assert.deepEqual(context.files, []);
  const result = await reviseReport({ state, report: 'Original\nKeep manual edit', request: 'Translate', history: [{ role: 'user', content: 'Earlier turn' }] }, { repositoryContext: context, complete: async messages => {
    const input = JSON.parse(messages[1].content);
    assert.deepEqual(input.repository_context.files, []);
    assert.equal(input.conversation_history[0].content, 'Earlier turn');
    return json({ changes: [{ old: 'Original', new: '原文' }], message: 'Translated.' });
  } });
  assert.equal(result.report, '原文\nKeep manual edit');
});

test('invalid plans, unsafe paths, excessive ranges and corrupted archives fail before writing', async () => {
  for (const files of [[{ ...range, path: '../index.js' }], [{ ...range, path: '.env.local' }], [{ ...range, path: 'missing.js' }], [{ ...range, start_line: 0 }], [{ ...range, start_line: 1, end_line: 181 }], Array(5).fill(range), [range, range]]) {
    await assert.rejects(retrieveRepositoryContext({ state, mode: 'generate' }, { complete: async () => plan(files) }));
  }
  await assert.rejects(retrieveRepositoryContext({ state, mode: 'generate' }, { complete: async () => 'invalid JSON' }), /valid JSON/);
  const archived = await loadHistoricalRepository(state);
  archived.files['index.js'].content += '\ncorrupted';
  await assert.rejects(retrieveRepositoryContext({ state, mode: 'generate' }, { loadSnapshot: async () => archived, complete: async () => plan([range]) }), /integrity/);
  const mismatched = await loadHistoricalRepository(state);
  mismatched.commit.sha = 'a'.repeat(40);
  await assert.rejects(retrieveRepositoryContext({ state, mode: 'generate' }, { loadSnapshot: async () => mismatched, complete: async () => { throw new Error('Must not call'); } }), /identity mismatch/);
});

test('content budget is enforced and a valid selection clamps its ending line to EOF', async () => {
  const snapshot = await loadHistoricalRepository(state);
  const content = 'x'.repeat(24_001);
  snapshot.files['large.md'] = { content, sha: createHash('sha1').update(`blob ${content.length}\0${content}`).digest('hex') };
  await assert.rejects(retrieveRepositoryContext({ state, mode: 'generate' }, { loadSnapshot: async () => snapshot, complete: async () => plan([{ path: 'large.md', start_line: 1, end_line: 1 }]) }), /budget/);
  const context = await retrieveRepositoryContext({ state, mode: 'generate' }, { complete: async () => plan([{ path: 'index.js', start_line: 130, end_line: 180 }]) });
  assert.ok(context.files[0].end_line < 180);
});

test('context-enabled revision can cite selected code but rejects new unverified URLs and mismatched commits', async () => {
  const context = await retrieveRepositoryContext({ state, mode: 'revise', request: 'Explain clearQueue' }, { complete: async () => plan([range]) });
  const original = structuredClone(state);
  const report = '# Other\nManual edit\n\n## Speaker Notes\nManual note.\n\n---\n\n# Implementation\nOld fact\n\n## Speaker Notes\nImplementation note.\n\n## Sources\n- [PR](https://github.com/sindresorhus/p-limit/pull/109)';
  const changes = [{ old: 'Old fact', new: 'The wrapper exposes clearQueue.' }, { old: '## Sources', new: `## Sources\n- [index.js](${context.files[0].url})` }];
  const revised = await reviseReport({ state, report, request: 'Explain clearQueue' }, { repositoryContext: context, complete: async () => json({ changes, message: 'Added implementation evidence.' }) });
  assert.ok(revised.report.startsWith('# Other\nManual edit\n'));
  assert.ok(revised.report.includes(context.files[0].url));
  assert.deepEqual(state, original);
  await assert.rejects(reviseReport({ state, report, request: 'Explain' }, { repositoryContext: context, complete: async () => json({ changes: [{ old: 'Old fact', new: '[Unverified](https://example.com/new-source)' }], message: 'Changed' }) }), /unverified source/);
  await assert.rejects(generateReport(state, { repositoryContext: { ...context, commit: 'a'.repeat(40) }, complete: async () => { throw new Error('Must not call'); } }), /identity mismatch/);
});

test('generation focus works with State-only mode and does not retrieve files', async () => {
  const response = await reportHandler('generate', { production: false, retrieveContext: async () => { throw new Error('Must not retrieve'); }, complete: async messages => {
    const input = JSON.parse(messages[1].content);
    assert.equal(input.generation_request, 'Focus on queue clearing');
    assert.deepEqual(input.state, state);
    assert.ok(!input.repository_context);
    return json(pages(state.trigger.source_ref_id));
  } })(request({ state, focus: 'Focus on queue clearing', useRepository: false }));
  assert.equal(response.status, 200);
});

test('HTTP orchestrates planning and generation using existing provider-independent JSON contract', async () => {
  let calls = 0;
  const response = await reportHandler('generate', { production: false, complete: async messages => {
    calls++;
    const input = JSON.parse(messages[1].content);
    if (calls === 1) { assert.equal(input.current_request, 'Explain clearQueue'); return plan([range]); }
    assert.deepEqual(input.state, state);
    assert.equal(input.repository_context.commit, state.source_commit_sha);
    return json(pages('repo-file-1'));
  } })(request({ state, focus: 'Explain clearQueue', useRepository: true }));
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  const result = await response.json();
  assert.equal(result.repository.status, 'read');
  assert.equal(result.repository.files[0].path, 'index.js');
  assert.ok(!('content' in result.repository.files[0]));
  assert.ok(result.report.includes(result.repository.files[0].url));
});

test('HTTP revision carries manual content/history, returns no-file trace, and rejects client context injection', async () => {
  let calls = 0;
  const response = await reportHandler('revise', { production: false, complete: async messages => {
    calls++;
    if (calls === 1) return plan([]);
    const input = JSON.parse(messages[1].content);
    assert.equal(input.current_report, 'Original\nManual');
    assert.equal(input.conversation_history[0].content, 'Earlier');
    return json({ changes: [{ old: 'Original', new: 'Updated' }], message: 'Updated.' });
  } })(request({ state, report: 'Original\nManual', request: 'Reword', history: [{ role: 'user', content: 'Earlier' }], useRepository: true }));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.report, 'Updated\nManual');
  assert.equal(result.repository.status, 'not_needed');
  assert.equal(calls, 2);
  for (const options of [{ useRepository: 'yes' }, { focus: 123 }, { repository_context: {} }]) {
    const rejected = await reportHandler('generate', { production: false, complete: async () => { throw new Error('Must not call'); } })(request({ state, ...options }));
    assert.equal(rejected.status, 400);
  }
  const unsupported = await reportHandler('generate', { production: false, complete: async () => { throw new Error('Must not call'); } })(request({ state: { ...state, source_commit_sha: 'a'.repeat(40) }, useRepository: true }));
  assert.equal(unsupported.status, 422);
  assert.equal((await unsupported.json()).code, 'REPOSITORY_CONTEXT_UNAVAILABLE');
});
