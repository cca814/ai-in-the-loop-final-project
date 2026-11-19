import { prepareState } from './state.js';
import { buildMessages } from './prompt.js';

const requiredTitles = ['Project Overview', 'Feature Progress', 'Recent Changes', 'Risks and Issues'];
const clean = value => typeof value === 'string' && value.trim() && !/[\r\n]/.test(value) && !/https?:\/\//i.test(value);
const escapeText = value => value.replace(/([\\`*_[\]<>#])/g, '\\$1');

export async function generateReport(state, { complete } = {}) {
  if (typeof complete !== 'function') throw new Error('A complete(messages) LLM function is required');
  const prepared = prepareState(state);
  let result;
  try { result = JSON.parse(await complete(buildMessages(prepared))); }
  catch (error) { throw new Error(`Could not obtain valid LLM JSON: ${error.message}`); }
  if (!Array.isArray(result.pages)) throw new Error('LLM response must contain pages');
  for (const title of requiredTitles) if (!result.pages.some(page => page.title === title)) throw new Error(`Missing page: ${title}`);
  const refs = new Map(prepared.source_refs.map(ref => [ref.id, ref]));
  refs.set('repository', { url: prepared.repository.url, title: prepared.repository.full_name });
  return result.pages.map(page => {
    if (!clean(page.title) || !clean(page.script) || !Array.isArray(page.bullets) || !page.bullets.length || !page.bullets.every(clean) || !Array.isArray(page.source_ids) || !page.source_ids.length) throw new Error('Invalid page content');
    const links = [...new Set(page.source_ids)].map(id => {
      const ref = refs.get(id);
      if (!ref) throw new Error(`Unknown response source: ${id}`);
      const url = new URL(ref.url);
      if (url.protocol !== 'https:') throw new Error('Source must use HTTPS');
      return `- [${escapeText(ref.title || ref.id || 'Repository')}](${url.href.replace(/\)/g, '%29')})`;
    });
    return `# ${escapeText(page.title)}\n\n${page.bullets.map(b => `- ${escapeText(b)}`).join('\n')}\n\n## Speaker Notes\n\n${escapeText(page.script)}\n\n## Sources\n\n${links.join('\n')}`;
  }).join('\n\n---\n\n') + '\n';
}
