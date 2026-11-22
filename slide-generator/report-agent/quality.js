import { parseReport } from './report-format.js';
import { reportRequirements } from './requirements.js';

/**
 * @param {string} report
 * @param {{state?: object, repositoryContext?: object, mergeHistory?: object, request?: string}} [options]
 */
export function inspectReport(report, { state, repositoryContext, mergeHistory, request = '' } = {}) {
  const pages = parseReport(report);
  const evidence = JSON.stringify({ state, repositoryContext, mergeHistory });
  const dates = new Set(evidence.match(/\b\d{4}-\d{2}-\d{2}\b/g) || []);
  const warnings = [];
  const requirements = reportRequirements(request);
  if (requirements.pages && requirements.pages !== pages.length) warnings.push({ code: 'PAGE_COUNT_MISMATCH', page: 1, message: `目前 ${pages.length} 頁，需求指定 ${requirements.pages} 頁。` });
  const scripts = new Set();
  const referencedUrls = [...new Set(report.match(/https?:\/\/[^\s)<>\]]+/g) || [])];
  const availableSources = [
    ...(state?.source_refs || []).map(ref => ({ id: ref.id, url: ref.url, title: ref.title })),
    ...(repositoryContext?.files || []).map(file => ({ id: file.source_id, url: file.url, title: file.path })),
    ...(mergeHistory?.merges || []).map(merge => ({ id: merge.source_id, url: merge.url, title: `PR #${merge.pr_number}` })),
  ];
  const pageEvidence = pages.map(({ body, script, sourceSection }, index) => {
    const page = index + 1;
    const text = `${body}\n${script}`;
    const add = (code, message) => warnings.push({ code, page, message });
    if (requirements.language === 'zh-Hant' && (text.match(/[这该为与发进项险问实现态将说业个体间达会对无]/g) || []).length >= 3) add('SIMPLIFIED_CHINESE_REVIEW', '需求指定繁體中文，但本頁可能含較多簡體字，請核對；此檢查不會改寫原文或專有名詞。');
    if (!sourceSection) add('CITATION_REVIEW', '此頁未顯示來源；來源為選用，但重要結論仍需人工對照證據。');
    for (const date of new Set(text.match(/\b\d{4}-\d{2}-\d{2}\b/g) || [])) if (!dates.has(date)) add('UNSUPPORTED_DATE', `日期 ${date} 未出現在本次提供的證據中，請核對。`);
    if (scripts.has(script)) add('REPEATED_NOTES', '講稿與其他頁完全相同，請確認是否需要調整。');
    scripts.add(script);
    if (body.length + sourceSection.length > 900) add('DENSE_SLIDE', '本頁可見文字偏多，建議檢查投影片是否溢出。');
    if (/\bmain\b|\bmaster\b|feature-[a-z\d-]+|\bin_progress\b/.test(body)) add('TECHNICAL_JARGON', '可見內容仍含內部分支、識別碼或狀態用詞，請確認符合報告對象。');
    if (state?.data_gaps?.some(gap => gap.section === 'risks') && /沒有(?:發現)?風險|無任何風險|no risks (?:were )?(?:found|identified)/i.test(text)) add('RISK_GAP_CONFLICT', '風險尚有資料缺口，但本頁可能宣稱沒有風險，請核對。');
    const cjk = (script.match(/[\u3400-\u9fff]/g) || []).length;
    const words = (script.match(/\b[A-Za-z]+\b/g) || []).length;
    return { page, title: body.split('\n')[0].replace(/^#\s+/, ''), sourceUrls: [...new Set(sourceSection.match(/https?:\/\/[^\s)<>\]]+/g) || [])], estimatedSpeakingSeconds: Math.ceil(cjk / 4 + words / 2.5) };
  });
  return {
    pageCount: pages.length, requirements, warnings,
    estimatedSpeakingSeconds: pageEvidence.reduce((sum, page) => sum + page.estimatedSpeakingSeconds, 0),
    provenance: { stateId: state?.event_id, repository: state?.repository?.full_name, commit: state?.source_commit_sha, request, mergeRange: mergeHistory ? { start: mergeHistory.start_commit, end: mergeHistory.end_commit, count: mergeHistory.merges.length } : null, availableSources, referencedUrls, pages: pageEvidence, verification: 'format-and-source-identifiers-only; claims require human review' },
  };
}
