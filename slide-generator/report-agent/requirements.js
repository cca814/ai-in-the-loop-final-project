import { ModelOutputError } from './errors.js';
import { parseReport } from './report-format.js';

const chineseNumber = value => {
  if (/^\d+$/.test(value)) return Number(value);
  const digits = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 零: 0 };
  if (value === '十') return 10;
  const parts = value.split('十');
  return parts.length === 2 ? (digits[parts[0]] || 1) * 10 + (digits[parts[1]] || 0) : digits[value];
};

export function reportRequirements(request = '', { currentPages } = {}) {
  const referencesPage = /第\s*[一二兩三四五六七八九十\d]+\s*頁/.test(request);
  const explicitTotal = /總共|總計|共\s*[一二兩三四五六七八九十\d]+\s*頁|整份.*(?:頁|pages)|最終.*(?:頁|pages)/i.test(request);
  const counts = [...request.matchAll(/(?:共|總共|總計|分成|改成|改為|整理成|拆成|合併成|做成|做|要|成)?\s*([1-9]\d*|[一二兩三四五六七八九十]{1,3})\s*(?:頁|張投影片|個章節|節|pages?\b|slides?\b)/gi)].filter(match => !/第\s*$/.test(request.slice(0, match.index))).map(match => chineseNumber(match[1]));
  const unique = [...new Set(counts)];
  if (unique.some(count => !Number.isInteger(count) || count < 1 || count > 100) || unique.length > 1) throw new ModelOutputError('請指定單一、介於 1 到 100 的報告頁數；相對增減或多個頁數請改用明確的最終頁數。', 'REQUIREMENTS_AMBIGUOUS');
  // Relative requests need the original draft; do not mistake "add 2 pages"
  // for a final two-page report. The review UI still exposes the full diff.
  const relative = /(?:增加|新增|加上|減少|刪除|多|少)\s*[一二兩三四五六七八九十\d]+\s*頁|\b(?:add|remove|delete)\s+\d+\s+(?:pages?|slides?)/i.test(request);
  const relativePages = relative && unique.length === 1 && currentPages ? currentPages + (/減少|刪除|\bremove\b|\bdelete\b/i.test(request) ? -unique[0] : unique[0]) : undefined;
  if (relativePages !== undefined && (relativePages < 1 || relativePages > 100)) throw new ModelOutputError('增減後的報告需介於 1 到 100 頁。', 'REQUIREMENTS_AMBIGUOUS');
  const language = /繁體|繁中|traditional\s+chinese/i.test(request) ? 'zh-Hant' : /(?:用|以|翻成|翻譯成|改成)\s*中文|(?:translate|write).*\bChinese\b/i.test(request) ? 'zh' : /(?:用|以|改成|翻成|翻譯成)\s*英文|\bin English\b|translate.*\bEnglish\b/i.test(request) ? 'en' : undefined;
  const limitedLanguage = /講稿|備忘|備註|標題|重點|speaker\s+notes?|\btitle\b|\bbullets?\b/i.test(request) && !/整份|整個|全文|全部|所有|whole|entire|full report/i.test(request);
  return { ...(relativePages !== undefined ? { pages: relativePages } : unique.length && !relative && (!referencesPage || explicitTotal) ? { pages: unique[0] } : {}), ...(language && !limitedLanguage ? { language } : {}) };
}

export function untranslatedChineseReport(report) {
  return parseReport(report).some(({ body, script }) => `${body}\n${script}`.split('\n').some(line => {
    const text = line.replace(/https?:\/\/\S+|`[^`]*`|\[[^\]]*\]\([^)]*\)/g, '');
    if ((text.match(/[\u3400-\u9fff]/g) || []).length >= 2) return false;
    return /^#\s+(?:Project Overview|Feature Progress|Recent Changes|Risks and Issues)\s*$/i.test(text) || ((text.match(/\b[A-Za-z]+\b/g) || []).length >= 5 && /\b(?:the|is|are|with|without|this|that|because|when|which|was|were|will|from|using|cannot|only|supports?|remain|returned|provided|unavailable)\b/i.test(text));
  }));
}

export function validateRequirements(report, requirements) {
  const pages = parseReport(report);
  if (pages.length > 100 || report.length > 100_000) throw new ModelOutputError('報告超過 100 頁或 100,000 字元。', 'REPORT_LIMIT_EXCEEDED');
  if (requirements.pages && pages.length !== requirements.pages) throw new ModelOutputError(`要求 ${requirements.pages} 頁，實際回覆 ${pages.length} 頁。`, 'REPORT_REQUIREMENT_INVALID');
  if (['zh', 'zh-Hant'].includes(requirements.language) && untranslatedChineseReport(report)) throw new ModelOutputError('要求中文報告，但仍有明顯英文敘述未翻譯。', 'REPORT_REQUIREMENT_INVALID');
  if (requirements.language === 'en' && pages.some(page => (page.body + page.script).match(/[\u3400-\u9fff]/g)?.length > 10)) throw new ModelOutputError('要求英文報告，但仍有明顯中文段落。', 'REPORT_REQUIREMENT_INVALID');
}
