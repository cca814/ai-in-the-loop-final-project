import { runReplay } from './replay.js';
import { publicRepositoryClient, parseRepositoryUrl } from '../report-agent/public-repository.js';
import { replayStore, repositoryId } from './store.js';

const [url, ...args] = process.argv.slice(2);
const options = { run: false, refresh: false, limit: 3, baseBranches: [] };
let unlock = false;
try {
  parseRepositoryUrl(url);
  const value = index => { const item = args[index]; if (!item || item.startsWith('--')) throw new Error('Missing option value'); return item; };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--run') options.run = true;
    else if (flag === '--plan') options.run = false;
    else if (flag === '--refresh') options.refresh = true;
    else if (flag === '--unlock-stale') unlock = true;
    else if (flag === '--limit') options.limit = Number(value(++index));
    else if (flag === '--base-branch') options.baseBranches.push(value(++index));
    else if (flag === '--output') options.root = value(++index);
    else throw new Error(`Unknown option: ${flag}`);
  }
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort(new Error('Cancelled; last accepted State was preserved')));
  const client = publicRepositoryClient({ signal: controller.signal });
  if (unlock) {
    await replayStore(repositoryId(parseRepositoryUrl(url)), { root: options.root }).unlockStale();
    console.log('Removed stale lock. Run again to resume.');
  } else {
    const provider = process.env.LLM_PROVIDER || 'openai';
    const model = process.env[({ gemini: 'GEMINI_MODEL', groq: 'GROQ_MODEL', openai: 'OPENAI_MODEL' })[provider]];
    const result = await runReplay(url, { ...options, client, signal: controller.signal, model, onProgress: event => console.log(`${event.stage}: ${event.position}/${event.total} PR #${event.pr}`) });
    console.log(JSON.stringify({ id: result.id, directory: result.directory, completed: result.completed, total: result.total, complete: result.complete, mode: options.run ? 'run' : 'plan-no-LLM', branches: result.plan?.branches, excludedBases: result.plan?.excluded_bases }, null, 2));
  }
} catch (error) {
  // Provider errors never contain response bodies or keys. Do not dump input/model text.
  console.error(error.code ? `Replay stopped [${error.code}]. Last accepted State is preserved.` : `Replay stopped: ${error.message}`);
  console.error('Usage: node --env-file=../.env.local cli.js https://github.com/owner/repo [--plan | --run --limit 3] [--base-branch master] [--refresh] [--output path] [--unlock-stale]');
  process.exitCode = 1;
}
