import { createHash } from 'node:crypto';
import { safePath, safeDirectoryPath, RepositoryContextError } from './repository-context.js';
import { readRequestJson } from './operation.js';

const shaPattern = /^[a-f0-9]{40}$/;
const maxFileBytes = 256_000;
export class PublicRepositoryError extends RepositoryContextError {
  constructor(code, message, status = 422) { super(message); this.code = code; this.status = status; }
}
export function parseRepositoryUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new PublicRepositoryError('REPOSITORY_URL_INVALID', '請輸入公開 GitHub repository 網址。', 400); }
  const match = /^\/([a-zA-Z0-9-]+)\/([a-zA-Z0-9_.-]+)\/?$/.exec(url.pathname);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash || !match) throw new PublicRepositoryError('REPOSITORY_URL_INVALID', '請使用 https://github.com/owner/repo 格式，不含分支路徑或查詢參數。', 400);
  const repository = `${match[1]}/${match[2].replace(/\.git$/, '')}`;
  if (repository.split('/').some(part => !part || part === '.' || part === '..')) throw new PublicRepositoryError('REPOSITORY_URL_INVALID', 'Repository 名稱不正確。', 400);
  return repository;
}

// Anonymous GET only: no user tokens, credentials, arbitrary hosts or redirects.
export function publicRepositoryClient({ fetchImpl = fetch, signal } = {}) {
  async function get(path, maxBytes = 2_000_000) {
    let response;
    try { response = await fetchImpl(`https://api.github.com/repos/${path}`, { method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20_000)]), headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'bridging-code-and-intent' } }); }
    catch { if (signal?.aborted) throw signal.reason; throw new PublicRepositoryError('GITHUB_UNAVAILABLE', '無法連線到 GitHub，請稍後重試。', 502); }
    if (!response.ok) {
      await response.body?.cancel();
      if ([403, 429].includes(response.status)) throw new PublicRepositoryError('GITHUB_RATE_LIMIT', 'GitHub 限制匿名讀取頻率，請等待額度恢復後重試。', 429);
      if ([404, 409, 422].includes(response.status)) throw new PublicRepositoryError('REPOSITORY_UNAVAILABLE', '找不到公開 repository 或指定版本，可能是空的、私有的，或已移除。');
      throw new PublicRepositoryError('GITHUB_UNAVAILABLE', 'GitHub 暫時無法提供資料，請稍後重試。', 502);
    }
    try { return await readRequestJson(response, maxBytes); }
    catch { throw new PublicRepositoryError('GITHUB_RESPONSE_INVALID', 'GitHub 回應過大或格式不正確。'); }
  }
  async function identity(url) {
    const requested = parseRepositoryUrl(url);
    const repo = await get(requested);
    if (repo.private !== false || typeof repo.full_name !== 'string' || parseRepositoryUrl(`https://github.com/${repo.full_name}`).toLowerCase() !== requested.toLowerCase()) throw new PublicRepositoryError('REPOSITORY_UNAVAILABLE', '只支援公開且名稱相符的 GitHub repository。');
    return repo;
  }
  async function loadSnapshot(state) {
    const repo = await identity(state.repository.url);
    if (repo.full_name !== state.repository.full_name || !shaPattern.test(state.source_commit_sha)) throw new PublicRepositoryError('REPOSITORY_IDENTITY_INVALID', 'Repository 或 commit 身分不符。');
    const commit = await get(`${repo.full_name}/commits/${state.source_commit_sha}`);
    const treeSha = commit.commit?.tree?.sha;
    if (commit.sha !== state.source_commit_sha || !shaPattern.test(treeSha)) throw new PublicRepositoryError('REPOSITORY_IDENTITY_INVALID', 'Commit 驗證失敗。');
    const tree = await get(`${repo.full_name}/git/trees/${treeSha}?recursive=1`, 8_000_000);
    if (tree.sha !== treeSha || tree.truncated || !Array.isArray(tree.tree)) throw new PublicRepositoryError('REPOSITORY_TREE_INCOMPLETE', '檔案清單不完整或過大，目前無法安全選檔。');
    const allDirectories = tree.tree.filter(entry => entry.type === 'tree');
    const directories = [];
    for (const entry of allDirectories.filter(entry => entry.mode === '040000' && shaPattern.test(entry.sha) && safeDirectoryPath(entry.path)).sort((a, b) => a.path.localeCompare(b.path))) {
      if (directories.length >= 100 || directories.join('').length + entry.path.length > 8000) break;
      directories.push(entry.path);
    }
    const directoryInventory = { directories, complete: directories.length === allDirectories.length };
    const entries = tree.tree.filter(file => file.type === 'blob' && ['100644', '100755'].includes(file.mode) && safePath(file.path) && !/(^|\/)(node_modules|vendor|dist|build)\//.test(file.path) && !/(?:lock\.json|\.lock|\.min\.[a-z]+)$/i.test(file.path) && Number.isInteger(file.size) && file.size <= maxFileBytes && shaPattern.test(file.sha));
    if (!entries.length || entries.length > 1500) throw new PublicRepositoryError('REPOSITORY_FILE_LIMIT', '可讀取檔案為零或超過 1,500 個，請改用較小的 repository。');
    const files = Object.fromEntries(entries.map(file => [file.path, { sha: file.sha, size: file.size }]));
    const loaded = new Map();
    return { repository: repo.full_name, commit: { sha: commit.sha }, files, directoryInventory, async readFile(path) {
      if (!Object.hasOwn(files, path)) throw new PublicRepositoryError('REPOSITORY_FILE_INVALID', '檔案不在此 commit 的允許清單中。');
      if (loaded.has(path)) return loaded.get(path);
      if (loaded.size >= 8) throw new PublicRepositoryError('REPOSITORY_FILE_LIMIT', '本次檔案下載數已達上限。');
      const blob = await get(`${repo.full_name}/git/blobs/${files[path].sha}`, 400_000);
      if (blob.sha !== files[path].sha || blob.encoding !== 'base64' || typeof blob.content !== 'string') throw new PublicRepositoryError('REPOSITORY_BLOB_INVALID', '檔案資料格式不正確。');
      const bytes = Buffer.from(blob.content, 'base64');
      if (bytes.length > maxFileBytes || bytes.length !== files[path].size || createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') !== blob.sha) throw new PublicRepositoryError('REPOSITORY_BLOB_INVALID', '檔案大小或完整性驗證失敗。');
      let content;
      try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { throw new PublicRepositoryError('REPOSITORY_FILE_INVALID', '選取的檔案不是 UTF-8 文字。'); }
      if (content.includes('\0') || content.startsWith('version https://git-lfs.github.com/spec/')) throw new PublicRepositoryError('REPOSITORY_FILE_INVALID', '不支援二進位檔案或 Git LFS 指標。');
      const file = { ...files[path], content }; loaded.set(path, file); return file;
    } };
  }
  async function resolve(url, pinnedCommit) {
    const repo = await identity(url);
    if (pinnedCommit !== undefined && !shaPattern.test(pinnedCommit)) throw new PublicRepositoryError('REPOSITORY_IDENTITY_INVALID', 'Commit 格式不正確。', 400);
    if (typeof repo.default_branch !== 'string' || !repo.default_branch) throw new PublicRepositoryError('REPOSITORY_UNAVAILABLE', 'Repository 尚無預設分支。');
    const commit = await get(`${repo.full_name}/commits/${encodeURIComponent(pinnedCommit || repo.default_branch)}`);
    if (!shaPattern.test(commit.sha) || (pinnedCommit && commit.sha !== pinnedCommit) || !Number.isFinite(Date.parse(commit.commit?.committer?.date))) throw new PublicRepositoryError('REPOSITORY_IDENTITY_INVALID', 'Commit 資料不完整。');
    return {
      evidence_kind: 'repository_snapshot', project_id: repo.full_name.replace('/', '-'), project_name: repo.name || repo.full_name,
      event_id: `repo-${commit.sha}`, source_commit_sha: commit.sha, updated_at: commit.commit.committer.date, base_state_id: null,
      repository: { full_name: repo.full_name, url: `https://github.com/${repo.full_name}` },
      description: typeof repo.description === 'string' ? repo.description.slice(0, 2000) : '',
      trigger: { type: 'repository_snapshot', source_ref_id: 'repo-commit', summary: '目前程式碼快照；未匯入 PR 合併紀錄，不能據此認定近期進度。' },
      source_refs: [{ id: 'repo-commit', type: 'commit', title: 'Selected repository commit', url: `https://github.com/${repo.full_name}/commit/${commit.sha}` }],
      features: [], milestones: [], risks: [],
      data_gaps: ['features', 'milestones', 'risks', 'recent_changes'].map(section => ({ section, reason: 'Not assessed: repository-only input, not an Intent Supervisor Project State.' })),
    };
  }
  return { get, identity, resolve, loadSnapshot };
}

export function repositoryImportHandler({ fetchImpl = fetch, production = process.env.NODE_ENV === 'production' } = {}) {
  return async request => {
    if (production) return Response.json({ error: '公開 repo 試用模式尚未啟用正式環境。' }, { status: 403 });
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return Response.json({ error: 'Origin rejected.' }, { status: 403 });
    try {
      const body = await readRequestJson(request, 4096);
      if (!body || typeof body.url !== 'string' || body.url.length > 300) throw new PublicRepositoryError('REPOSITORY_URL_INVALID', '請輸入公開 GitHub repository 網址。', 400);
      const client = publicRepositoryClient({ fetchImpl, signal: AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]) });
      return Response.json({ state: await client.resolve(body.url) }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      return Response.json({ code: error instanceof PublicRepositoryError ? error.code : 'REPOSITORY_IMPORT_FAILED', error: error instanceof PublicRepositoryError ? error.message : '無法載入 repo；請確認網址與網路後重試。' }, { status: error instanceof PublicRepositoryError ? error.status : 400 });
    }
  };
}
