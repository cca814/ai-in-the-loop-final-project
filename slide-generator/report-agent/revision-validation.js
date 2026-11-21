import { parseReport, normalizeReportSeparators, ReportFormatError } from './report-format.js';
import { RevisionOutputError } from './errors.js';

export function wantsWholeChineseTranslation(request) {
  const target = /(?:繁體|繁中|中文|traditional Chinese|Chinese)/i.test(request);
  const translation = /(?:翻譯|翻成|譯成|改成|改為|轉成|轉為|translate|Chinese|繁體中文|繁中)/i.test(request);
  const limited = /(?:講稿|備忘|備註|標題|重點|來源|段落|這段|僅|只|speaker|notes?|title|bullets?|sources?|section|paragraph|only)/i.test(request);
  return target && translation && !limited;
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
  // Plain-text legacy drafts remain editable. Markdown report pages must keep
  // their presentation structure, including after an empty/no-op response.
  if (/^#\s+\S/m.test(report) || /^#\s+\S/m.test(revised)) {
    try { parseReport(revised); }
    catch (error) {
      if (!(error instanceof ReportFormatError)) throw error;
      throw new RevisionOutputError(error.publicMessage, 'REVISION_STRUCTURE_INVALID');
    }
    revised = normalizeReportSeparators(revised);
  }
  if (allowedUrls) for (const url of reportUrls(revised)) if (!allowedUrls.has(url)) throw new RevisionOutputError('Revision introduced an unverified source URL', 'REVISION_SOURCE_INVALID');
  if (wantsWholeChineseTranslation(request) && hasUntranslatedReportText(revised)) throw new RevisionOutputError('Whole-report translation left obvious English report text', 'REVISION_TRANSLATION_INCOMPLETE');
  return { report: revised, message: result.message, changed: revised !== report };
}

export function reportUrls(text) {
  return text.match(/https?:\/\/[^\s)<>\]]+/g) || [];
}
