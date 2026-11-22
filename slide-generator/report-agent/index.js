import { reportRequirements, validateRequirements } from './requirements.js';
import { prepareEvidence as prepareState } from './evidence.js';
import { buildMessages } from './prompt.js';
import { GenerationOutputError } from './errors.js';
import { repositorySources } from './repository-context.js';
import { mergeHistorySources } from './merge-history.js';

const clean = value => typeof value === 'string' && value.trim() && !/[\r\n]/.test(value) && !/https?:\/\//i.test(value);
const scriptText = value => typeof value === 'string' && value.trim() && !/https?:\/\//i.test(value) && !/^---\s*$/m.test(value);
const escapeText = value => value.replace(/([\\`*_[\]<>#])/g, '\\$1');

export async function generateReport(state, { complete, repositoryContext, focus = '', mergeHistory, maxCorrectionRetries = 1 } = {}) {
  if (typeof complete !== 'function') throw new Error('A complete(messages) LLM function is required');
  const prepared = prepareState(state);
  const requirements = reportRequirements(focus);
  const extraSources = [...repositorySources(repositoryContext, prepared), ...mergeHistorySources(mergeHistory, prepared)];
  if (![0, 1].includes(maxCorrectionRetries)) throw new Error('Invalid correction retry limit');
  const refs = new Map(prepared.source_refs.map(ref => [ref.id, ref]));
  refs.set('repository', { url: prepared.repository.url, title: prepared.repository.full_name });
  for (const ref of extraSources) refs.set(ref.id, ref);
  const messages = buildMessages(prepared, { repositoryContext, focus, mergeHistory });
  if (Object.keys(requirements).length) messages[1].content = JSON.stringify({ ...JSON.parse(messages[1].content), requirements });
  if (requirements.pagesPerDirectory) messages[0].content += ' requirements.pagesPerDirectory=1 allocates one page per evidenced directory, not a one-page report. Use the supplied directory inventory, do not invent folders or treat root files as directories, and do not infer directory purposes without supporting excerpts or State. Explain missing input rather than fabricating a directory description.';
  for (let attempt = 0; ; attempt++) {
    const response = await complete(messages);
    try {
      let result;
      try { result = JSON.parse(response); }
      catch { throw new GenerationOutputError('Could not obtain valid LLM JSON', 'GENERATION_JSON_INVALID'); }
      const report = renderReport(result, refs);
      try { validateRequirements(report, requirements); }
      catch (error) { throw new GenerationOutputError(error.message, 'GENERATION_REQUIREMENT_INVALID', undefined, 'requirements'); }
      return report;
    } catch (error) {
      if (!(error instanceof GenerationOutputError) || attempt >= maxCorrectionRetries) throw error;
      messages.push({ role: 'user', content: JSON.stringify({ correction_required: error.code, page: error.page, field: error.field, requirements, detail: error.code === 'GENERATION_REQUIREMENT_INVALID' ? error.message : undefined, allowed_source_ids: [...refs.keys()], instruction: 'The report was rejected and nothing was saved. Return a complete corrected JSON object with a nonempty pages array. Each page requires title: nonempty single-line string, bullets: nonempty array of nonempty single-line strings, script: nonempty string (paragraphs allowed), source_ids: optional array of exact allowed source ID strings (omit or use [] when no source section is needed). Do not put URLs in title, bullets or script, and do not put a standalone --- separator in script. Use ONLY the earlier supplied evidence and preserve its uncertainty and the requested audience/structure. Source IDs are identifiers, not URLs, PR numbers, titles, or new invented names. Do not invent facts to repair formatting.' }) });
    }
  }
}

function renderReport(result, refs) {
  if (!result || !Array.isArray(result.pages) || !result.pages.length) throw new GenerationOutputError('LLM response must contain nonempty pages', 'GENERATION_STRUCTURE_INVALID', undefined, 'pages');
  return result.pages.map((page, index) => {
    const field = !page || !clean(page.title) ? 'title' : !scriptText(page.script) ? 'script' : !Array.isArray(page.bullets) || !page.bullets.length || !page.bullets.every(clean) ? 'bullets' : page.source_ids !== undefined && !Array.isArray(page.source_ids) ? 'source_ids' : null;
    if (field) throw new GenerationOutputError('Invalid page content', field === 'source_ids' ? 'GENERATION_SOURCE_INVALID' : 'GENERATION_CONTENT_INVALID', index + 1, field);
    const links = [...new Set(page.source_ids ?? [])].map(id => {
      const ref = refs.get(id);
      if (typeof id !== 'string' || !ref) throw new GenerationOutputError('Unknown response source', 'GENERATION_SOURCE_INVALID', index + 1, 'source_ids');
      const url = new URL(ref.url);
      if (url.protocol !== 'https:') throw new Error('Source must use HTTPS');
      return `- [${escapeText(ref.title || ref.id || 'Repository')}](${url.href.replace(/\)/g, '%29')})`;
    });
    return `# ${escapeText(page.title)}\n\n${page.bullets.map(b => `- ${escapeText(b)}`).join('\n')}\n\n## Speaker Notes\n\n${escapeText(page.script)}${links.length ? `\n\n## Sources\n\n${links.join('\n')}` : ''}`;
  }).join('\n\n---\n\n') + '\n';
}
