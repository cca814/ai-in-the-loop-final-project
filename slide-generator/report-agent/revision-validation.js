import { parseReport, normalizeReportSeparators, ReportFormatError } from './report-format.js';
import { RevisionOutputError } from './errors.js';

// A narrow intent guard, not a readability or factual-accuracy assessment.
export function wantsPlainLanguageRewrite(request) {
  if (/(?:不用|不要|無需|不必)(?:再)?(?:改寫|修改|調整|白話)|(?:do not|don't|no need to)\s+(?:rewrite|simplify|change)/i.test(request)) return false;
  return /白話|淺顯|通俗|非(?:技術|專業)(?:人士|人員|讀者|背景|觀眾)?|(?:沒有|沒|不具備|缺乏).{0,16}專業(?:知識|背景)|(?:外行|一般人|新手).{0,16}(?:看懂|聽懂|理解)|plain language|lay(?:person|people| audience)|non[- ]technical/i.test(request) ||
    /(?:術語|專有名詞|jargon)/i.test(request) && /(?:不懂|說明|解釋|避開|避免|減少|移除|explain|avoid|remove|reduce)/i.test(request);
}

export function wantsWholeChineseTranslation(request) {
  const target = /(?:繁體|繁中|中文|traditional Chinese|Chinese)/i.test(request);
  const translation = /(?:翻譯|翻成|譯成|改成|改為|轉成|轉為|translate|Chinese|繁體中文|繁中)/i.test(request);
  const whole = /(?:整份|整個|全文|全部|所有|whole|entire|full report)/i.test(request);
  const limited = /(?:講稿|備忘|備註|標題|重點|來源|段落|這段|僅|只|speaker|notes?|title|bullets?|sources?|section|paragraph|only)/i.test(request);
  return target && translation && (whole || !limited);
}

// A narrow guard for obvious partial/no-op translations, not a language detector.
export function hasUntranslatedReportText(report) {
  let sources = false;
  let fenced = false;
  for (const line of report.split('\n')) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    if (/^#\s|^---\s*$/.test(line)) sources = false;
    if (/^##\s+(?:Sources|來源|來源連結|參考來源|參考資料)\s*$/i.test(line)) { sources = true; continue; }
    if (sources) continue;
    if (/^#\s+(?:Project Overview|Feature Progress|Recent Changes|Risks and Issues)\s*$/i.test(line)) return true;
    const prose = line.replace(/`[^`]*`|https?:\/\/\S+|\[[^\]]*\]\([^)]*\)/g, '');
    if ((prose.match(/[\u3400-\u9fff]/g) || []).length >= 2) continue;
    if ((prose.match(/\b[A-Za-z]+\b/g) || []).length >= 5 && /\b(?:the|is|are|with|without|this|that|because|when|which|was|were|will|from|using|cannot|only|supports?|remain|returned|provided|unavailable)\b/i.test(prose)) return true;
  }
  return false;
}

export function applyRevisionResult(result, { report, request, allowedUrls }) {
  if (!result || !Array.isArray(result.changes) || typeof result.message !== 'string') throw new RevisionOutputError('Invalid revision response');
  const edits = result.changes.map(change => {
    if (!change || typeof change.old !== 'string' || !change.old || typeof change.new !== 'string') throw new RevisionOutputError('Invalid replacement');
    const start = report.indexOf(change.old);
    if (start < 0 || report.indexOf(change.old, start + 1) !== -1) throw new RevisionOutputError('Replacement must match exactly once', 'REVISION_MATCH_FAILED');
    return { start, end: start + change.old.length, text: change.new };
  }).sort((a, b) => a.start - b.start);
  for (let i = 1; i < edits.length; i++) if (edits[i].start < edits[i - 1].end) throw new RevisionOutputError('Overlapping replacements', 'REVISION_OVERLAP');
  let revised = report;
  for (const edit of edits.reverse()) revised = revised.slice(0, edit.start) + edit.text + revised.slice(edit.end);
  const wordingChanged = revised.replace(/\s/g, '') !== report.replace(/\s/g, '');
  // Plain-text legacy drafts remain editable. Markdown report pages must keep
  // their presentation structure, including after an empty/no-op response.
  if (/^#\s+\S/m.test(report) || /^#\s+\S/m.test(revised)) {
    try { parseReport(revised); }
    catch (error) {
      if (!(error instanceof ReportFormatError)) throw error;
      throw new RevisionOutputError(error.publicMessage, 'REVISION_STRUCTURE_INVALID');
    }
    if (/(?:只|僅|only)/i.test(request)) {
      const before = parseReport(report);
      const after = parseReport(revised);
      const named = before.map((page, index) => request.toLowerCase().includes(page.body.split('\n')[0].replace(/^#\s+/, '').toLowerCase()) ? index : -1).filter(index => index >= 0);
      if (named.length === 1 && (before.length !== after.length || before.some((page, index) => index !== named[0] && JSON.stringify(page) !== JSON.stringify(after[index])))) throw new RevisionOutputError('The request names only one page but other pages were changed', 'REVISION_SCOPE_INVALID');
    }
    revised = normalizeReportSeparators(revised);
  }
  if (allowedUrls) for (const url of reportUrls(revised)) if (!allowedUrls.has(url)) throw new RevisionOutputError('Revision introduced an unverified source URL', 'REVISION_SOURCE_INVALID');
  if (wantsPlainLanguageRewrite(request) && !wordingChanged) throw new RevisionOutputError('The audience rewrite made no textual change. Rephrase existing technical content in accessible language without changing its facts; unchanged text or whitespace-only edits do not fulfill this request.', 'REVISION_NO_EFFECT');
  if (wantsWholeChineseTranslation(request) && hasUntranslatedReportText(revised)) throw new RevisionOutputError('Whole-report translation left obvious English report text', 'REVISION_TRANSLATION_INCOMPLETE');
  return { report: revised, message: result.message, changed: revised !== report };
}

export function reportUrls(text) {
  return text.match(/https?:\/\/[^\s)<>\]]+/g) || [];
}
