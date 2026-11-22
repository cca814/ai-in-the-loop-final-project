import { readFile } from 'node:fs/promises';
import { RepositoryContextError } from '../../../report-agent/repository-context.js';
import { historicalArchiveUrls } from './repository-archives.js';
const repository = 'sindresorhus/p-limit';

// A closed allowlist resolves only archived fixture names, never a user path.
export async function loadHistoricalRepository(state) {
  if (state.repository.full_name !== repository || state.repository.url !== `https://github.com/${repository}` || !/^[a-f0-9]{40}$/.test(state.source_commit_sha)) throw new RepositoryContextError('Unsupported repository');
  const inventory = JSON.parse(await readFile(new URL('../inventory.json', import.meta.url), 'utf8'));
  const entry = inventory.entries.find(item => item.source_commit_sha === state.source_commit_sha);
  if (!entry || !/^\d{3}-pr-\d+\.json$/.test(entry.file)) throw new RepositoryContextError('Unknown snapshot');
  const archiveUrl = Object.hasOwn(historicalArchiveUrls, entry.file) ? historicalArchiveUrls[entry.file] : undefined;
  if (!archiveUrl) throw new RepositoryContextError('Unknown snapshot asset');
  const snapshot = JSON.parse(await readFile(archiveUrl, 'utf8'));
  if (snapshot.repository !== repository || snapshot.commit.sha !== state.source_commit_sha || snapshot.pr.merge_commit_sha !== state.source_commit_sha) throw new RepositoryContextError('Snapshot identity mismatch');
  return snapshot;
}

