import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseRepositoryUrl, publicRepositoryClient, repositoryImportHandler } from './public-repository.js';
import { retrieveRepositoryContext, repositorySources } from './repository-context.js';
import { reportHandler } from './http.js';
import { prepareEvidence } from './evidence.js';
import { prepareState } from './state.js';

const commit = 'a'.repeat(40), tree = 'b'.repeat(40), content = '# Example\nA small public library.\n';
const sha = createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0${content}`).digest('hex');
const state = { repository: { full_name: 'example/library', url: 'https://github.com/example/library' }, source_commit_sha: commit, source_refs: [] };
function fixture(overrides = {}) {
  const calls = [];
  const responses = {
    'example/library': { private: false, full_name: 'example/library', default_branch: 'main' },
    [`example/library/commits/${commit}`]: { sha: commit, commit: { tree: { sha: tree }, committer: { date: '2026-11-22T00:00:00Z' } } },
    'example/library/commits/main': { sha: commit, commit: { committer: { date: '2026-11-22T00:00:00Z' } } },
    [`example/library/git/trees/${tree}?recursive=1`]: { sha: tree, truncated: false, tree: [
      { path: 'README.md', type: 'blob', mode: '100644', sha, size: Buffer.byteLength(content) },
      { path: '.env.local', type: 'blob', mode: '100644', sha, size: 10 },
      { path: 'link.md', type: 'blob', mode: '120000', sha, size: 10 },
    ] },
    [`example/library/git/blobs/${sha}`]: { sha, encoding: 'base64', content: Buffer.from(content).toString('base64') }, ...overrides,
  };
  const client = publicRepositoryClient({ fetchImpl: async (url, options) => {
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, undefined);
    const path = url.replace('https://api.github.com/repos/', ''); calls.push(path);
    const result = responses[path]; assert.ok(result, path);
    return result instanceof Response ? result : Response.json(result);
  } });
  return { client, calls };
}
test('accept root GitHub URLs only; reject alternate hosts, credentials and path injection', () => {
  assert.equal(parseRepositoryUrl('https://github.com/example/library.git/'), 'example/library');
  for (const url of ['http://github.com/a/b', 'https://github.com.evil/a/b', 'https://user:pass@github.com/a/b', 'https://github.com/a/b/tree/main', 'https://github.com/a/b?x=1', 'https://localhost/a/b', 'https://github.com/a/b#readme']) assert.throws(() => parseRepositoryUrl(url));
});
test('inventory does not download bodies; planner reads only exact selected commit blobs', async () => {
  const { client, calls } = fixture();
  const snapshot = await client.loadSnapshot(state);
  assert.deepEqual(Object.keys(snapshot.files), ['README.md']);
  assert.equal(calls.length, 3);
  const context = await retrieveRepositoryContext({ state, mode: 'generate' }, { loadSnapshot: async () => snapshot, complete: async messages => {
    const input = JSON.parse(messages[1].content); assert.equal(input.available_files[0].lines, null);
    return JSON.stringify({ files: [{ path: 'README.md', start_line: 1, end_line: 100 }], reason: 'Understand purpose' });
  } });
  assert.equal(context.files[0].content, content); assert.equal(context.files[0].end_line, 3); assert.equal(calls.length, 4);
  await snapshot.readFile('README.md'); assert.equal(calls.length, 4);
  await assert.rejects(() => snapshot.readFile('.env.local'));
  let attempts = 0;
  await retrieveRepositoryContext({ state, mode: 'generate' }, { loadSnapshot: async () => snapshot, complete: async messages => {
    attempts++;
    if (attempts === 2) assert.equal(JSON.parse(messages.at(-1).content).available_files[0].lines, 3);
    return JSON.stringify({ files: [{ path: 'README.md', start_line: attempts === 1 ? 1000 : 1, end_line: attempts === 1 ? 1001 : 3 }], reason: 'Read purpose' });
  } });
  assert.equal(attempts, 2); assert.equal(calls.length, 4);
});

test('directory tasks receive verified names separately from file excerpts; ordinary edits do not', async () => {
  const directories = ['.github', '.github/workflows', 'scripts'];
  const { client, calls } = fixture({ [`example/library/git/trees/${tree}?recursive=1`]: { sha: tree, truncated: false, tree: [
    ...directories.map(path => ({ path, type: 'tree', mode: '040000', sha: tree })),
    { path: 'README.md', type: 'blob', mode: '100644', sha, size: Buffer.byteLength(content) },
  ] } });
  const snapshot = await client.loadSnapshot(state);
  assert.deepEqual(snapshot.directoryInventory, { directories, complete: true });
  const context = await retrieveRepositoryContext({ state, mode: 'revise', request: '每個資料夾一頁' }, { loadSnapshot: async () => snapshot, complete: async messages => {
    assert.deepEqual(JSON.parse(messages[1].content).directory_inventory.directories, directories);
    return JSON.stringify({ files: [], reason: 'Inventory only; purpose unassessed' });
  } });
  assert.deepEqual(context.inventory.directories, directories);
  assert.equal(repositorySources(context, state)[0].id, 'repo-tree');
  assert.equal(calls.length, 3); // No file bodies were downloaded.
  const plain = await retrieveRepositoryContext({ state, mode: 'revise', request: '縮短講稿' }, { loadSnapshot: async () => snapshot, complete: async () => JSON.stringify({ files: [], reason: 'Wording only' }) });
  assert.equal(plain.inventory, undefined);
  assert.throws(() => repositorySources({ ...context, inventory: { ...context.inventory, directories: ['../secret'] } }, state));
});
test('truncated trees, private repos, wrong blob hashes and GitHub rate limits fail safely', async () => {
  await assert.rejects(() => fixture({ 'example/library': { private: true } }).client.loadSnapshot(state), { code: 'REPOSITORY_UNAVAILABLE' });
  await assert.rejects(() => fixture({ [`example/library/git/trees/${tree}?recursive=1`]: { sha: tree, truncated: true, tree: [] } }).client.loadSnapshot(state), { code: 'REPOSITORY_TREE_INCOMPLETE' });
  const snapshot = await fixture({ [`example/library/git/blobs/${sha}`]: { sha, encoding: 'base64', content: Buffer.from('changed').toString('base64') } }).client.loadSnapshot(state);
  await assert.rejects(() => snapshot.readFile('README.md'), { code: 'REPOSITORY_BLOB_INVALID' });
  await assert.rejects(() => fixture({ 'example/library': new Response('', { status: 403 }) }).client.loadSnapshot(state), { code: 'GITHUB_RATE_LIMIT', status: 429 });
});

test('repository snapshots are distinct from official Project State and preserve unknown assessments', async () => {
  const snapshot = await fixture().client.resolve(state.repository.url);
  assert.equal(prepareEvidence(snapshot).evidence_kind, 'repository_snapshot');
  assert.throws(() => prepareState(snapshot), /Trigger/);
  assert.throws(() => prepareEvidence({ ...snapshot, risks: [{ id: 'invented' }] }));
  assert.throws(() => prepareEvidence({ ...snapshot, data_gaps: [] }));
});

test('HTTP generation and multi-turn revision use pinned remote evidence, existing JSON and source validation', async () => {
  const { client, calls } = fixture();
  const snapshot = await client.resolve(state.repository.url);
  let modelCalls = 0;
  const complete = async messages => {
    modelCalls++;
    const payload = JSON.parse(messages[1].content);
    if (payload.available_files) return JSON.stringify({ files: [{ path: 'README.md', start_line: 1, end_line: 50 }], reason: 'Purpose' });
    assert.match(messages[0].content, /NOT an Intent Supervisor Project State/);
    assert.equal(payload.state.source_commit_sha, commit);
    assert.equal(payload.state.description, ''); // client-supplied prose was replaced
    assert.equal(payload.repository_context.files[0].content, content);
    return JSON.stringify({ pages: [{ title: '程式碼現況', bullets: ['這是一個小型公開函式庫。'], script: '文件描述目前提供的函式庫。', source_ids: ['repo-file-1'] }] });
  };
  const request = body => new Request('http://localhost/api/reports/generate', { method: 'POST', body: JSON.stringify(body) });
  const response = await reportHandler('generate', { production: false, publicClient: () => client, complete })(request({ state: { ...snapshot, description: 'UNTRUSTED CLIENT TEXT' }, useRepository: true }));
  const generated = await response.json();
  assert.equal(response.status, 200, JSON.stringify(generated)); assert.equal(modelCalls, 2);
  assert.ok(generated.report.includes(`/blob/${commit}/README.md#L1-L3`));
  assert.equal(calls.filter(path => path.endsWith('/commits/main')).length, 1); // never resolve latest during generation
  const revised = await reportHandler('revise', { production: false, publicClient: () => client, complete: async messages => {
    const payload = JSON.parse(messages[1].content);
    assert.equal(payload.conversation_history[0].content, '先前要求');
    assert.match(messages[0].content, /NOT an Intent Supervisor Project State/);
    return JSON.stringify({ changes: [{ old: '文件描述目前提供的函式庫。', new: '文件說明這個函式庫。' }], message: '精簡講稿。' });
  } })(request({ state: snapshot, report: generated.report, request: '精簡講稿', history: [{ role: 'user', content: '先前要求' }], useRepository: false }));
  assert.equal(revised.status, 200); assert.match((await revised.json()).report, /文件說明這個函式庫/);
  const invalid = await reportHandler('generate', { production: false, publicClient: () => client, complete })(request({ state: snapshot, mergeRange: { startCommit: commit, endCommit: commit } }));
  assert.equal(invalid.status, 400); assert.equal((await invalid.json()).code, 'MERGE_RANGE_UNAVAILABLE');
});

test('import endpoint rejects cross-origin, production, invalid URLs and oversized payloads before network', async () => {
  const handler = repositoryImportHandler({ production: false, fetchImpl: () => { throw new Error('must not fetch'); } });
  assert.equal((await handler(new Request('http://localhost/api/reports/repository', { method: 'POST', headers: { origin: 'http://evil.example' }, body: '{}' }))).status, 403);
  assert.equal((await handler(new Request('http://localhost/api/reports/repository', { method: 'POST', body: JSON.stringify({ url: 'https://localhost/private' }) }))).status, 400);
  assert.equal((await handler(new Request('http://localhost/api/reports/repository', { method: 'POST', body: JSON.stringify({ url: 'x'.repeat(5000) }) }))).status, 400);
  assert.equal((await repositoryImportHandler({ production: true })(new Request('http://localhost/api/reports/repository', { method: 'POST', body: '{}' }))).status, 403);
});
