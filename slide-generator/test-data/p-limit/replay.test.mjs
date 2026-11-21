import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildState } from './replay.mjs';

const inventory = JSON.parse(await readFile(new URL('./inventory.json', import.meta.url)));
const inputs = await Promise.all(inventory.entries.map(entry => readFile(new URL(`./inputs/${entry.file}`, import.meta.url)).then(JSON.parse)));
const states = await Promise.all(inventory.entries.map(entry => readFile(new URL(`./states/${entry.file}`, import.meta.url)).then(JSON.parse)));
const stateFor = number => states.find(state => state.trigger.source_ref_id === `pr-${number}`);
const hasFeature = (state, id) => state.features.some(feature => feature.id === `feature-${id}`);
const gitHash = (type, data) => createHash('sha1').update(`${type} ${data.length}\0`).update(data).digest('hex');

function treeHash(files) {
  const root = new Map();
  for (const [path, file] of Object.entries(files)) {
    const parts = path.split('/');
    let node = root;
    for (const part of parts.slice(0, -1)) { if (!node.has(part)) node.set(part, new Map()); node = node.get(part); }
    node.set(parts.at(-1), file);
  }
  function hash(node) {
    const entries = [...node.entries()].sort(([a, av], [b, bv]) => Buffer.compare(Buffer.from(a + (av instanceof Map ? '/' : '')), Buffer.from(b + (bv instanceof Map ? '/' : ''))));
    const bytes = entries.map(([name, value]) => Buffer.concat([
      Buffer.from(`${value instanceof Map ? '40000' : value.mode.replace(/^0+/, '')} ${name}\0`),
      Buffer.from(value instanceof Map ? hash(value) : value.sha, 'hex'),
    ]));
    return gitHash('tree', Buffer.concat(bytes));
  }
  return hash(root);
}

test('covers all collected merges, excludes closed unmerged PRs and orders by merge time', () => {
  assert.equal(inputs.length, inventory.merged_pr_count);
  assert.equal(inputs.length, 21);
  assert.equal(inputs.length + inventory.excluded_unmerged_prs.length, inventory.closed_pr_count);
  assert.equal(inventory.pagination.page_2_count, 0);
  assert.equal(new Set(inputs.map(input => input.pr.number)).size, 21);
  for (let i = 0; i < inputs.length; i++) {
    assert.ok(!inventory.excluded_unmerged_prs.includes(inputs[i].pr.number));
    if (i) assert.ok(inputs[i - 1].pr.merged_at < inputs[i].pr.merged_at);
  }
  assert.ok(inputs.findIndex(input => input.pr.number === 83) < inputs.findIndex(input => input.pr.number === 79));
});

test('every archived byte and complete repository tree matches GitHub Git object hashes', () => {
  for (const input of inputs) {
    for (const file of Object.values(input.files)) assert.equal(gitHash('blob', Buffer.from(file.content)), file.sha);
    assert.equal(treeHash(input.files), input.commit.tree_sha, `Incomplete or changed repository tree for PR ${input.pr.number}`);
  }
});

test('replays exactly from previous State and this merge input, without mutating either', () => {
  let previous = null;
  for (let i = 0; i < inputs.length; i++) {
    const before = structuredClone({ previous, input: inputs[i] });
    const next = buildState(previous, inputs[i]);
    assert.deepEqual({ previous, input: inputs[i] }, before);
    assert.deepEqual(next, states[i]);
    assert.equal(next.base_state_id, previous?.event_id || null);
    assert.equal(next.source_commit_sha, inputs[i].pr.merge_commit_sha);
    assert.equal(next.updated_at, inputs[i].pr.merged_at);
    previous = next;
  }
});

test('citations cannot refer to future PRs or floating documentation branches', () => {
  const seen = new Set();
  for (let i = 0; i < states.length; i++) {
    const state = states[i];
    seen.add(inputs[i].pr.number);
    const used = new Set([state.trigger.source_ref_id, ...[...state.features, ...state.risks, ...state.milestones].flatMap(item => item.source_ref_ids)]);
    for (const ref of state.source_refs) {
      assert.ok(used.has(ref.id), `Unused reference ${ref.id}`);
      if (ref.type === 'pull_request') assert.ok(seen.has(ref.number));
      if (ref.type === 'document') {
        assert.ok(ref.url.includes(`/blob/${state.source_commit_sha}/`));
        assert.ok(inputs[i].files[ref.path]);
      }
    }
    for (const section of ['milestones', 'features', 'risks']) assert.ok(state.data_gaps.some(gap => gap.section === section));
    for (const feature of state.features.filter(feature => feature.status === 'done')) assert.ok(feature.source_ref_ids.some(id => state.source_refs.find(ref => ref.id === id)?.type === 'pull_request'));
    assert.ok(state.milestones.every(item => !('target_date' in item)));
  }
});

test('capabilities appear at their historical snapshots, and intermediate direct commits are not attributed to the trigger', () => {
  assert.equal(hasFeature(stateFor(1), 'sync-functions'), false);
  assert.equal(hasFeature(stateFor(4), 'sync-functions'), true);
  assert.equal(hasFeature(stateFor(8), 'counts'), false);
  assert.equal(hasFeature(stateFor(9), 'counts'), true);
  assert.equal(hasFeature(stateFor(12), 'clear-queue'), false);
  assert.equal(hasFeature(stateFor(20), 'clear-queue'), true);
  assert.equal(hasFeature(stateFor(83), 'dynamic-concurrency'), false);
  assert.equal(hasFeature(stateFor(79), 'dynamic-concurrency'), true);
  assert.equal(hasFeature(stateFor(93), 'map'), false);
  assert.equal(hasFeature(stateFor(98), 'map'), true);
  assert.equal(hasFeature(stateFor(98), 'reject-on-clear'), false);
  assert.equal(hasFeature(stateFor(108), 'reject-on-clear'), true);
  assert.equal(stateFor(108).features.find(feature => feature.id === 'feature-reject-on-clear').status, 'unknown');
  assert.ok(!stateFor(108).trigger.feature_ids.includes('feature-reject-on-clear'));
  assert.equal(hasFeature(stateFor(108), 'limited-function-clear'), false);
  assert.equal(hasFeature(stateFor(109), 'limited-function-clear'), true);
  assert.equal(stateFor(1).risks.length, 0);
  assert.equal(stateFor(20).risks[0].severity, 'unknown');
});

test('rejects backwards replay and mismatched merge SHA', () => {
  assert.throws(() => buildState(states.at(-1), inputs[0]), /chronological/);
  assert.throws(() => buildState(null, { ...inputs[0], commit: { ...inputs[0].commit, sha: 'a'.repeat(40) } }), /mismatched/);
});
