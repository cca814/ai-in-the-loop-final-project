// Shared by revision validation and Slidev conversion; no provider dependencies.
export class ReportFormatError extends Error {
  constructor(message, publicMessage) {
    super(message);
    this.publicMessage = publicMessage;
  }
}

// A top-level heading starts a new page. Restore missing separators without
// changing wording, citations, or notes (including manually edited content).
export function normalizeReportSeparators(report) {
  let seenTitle = false;
  return report.replace(/\r\n/g, '\n').split('\n').flatMap(line => {
    if (/^---\s*$/.test(line)) seenTitle = false;
    if (!/^#\s+\S/.test(line)) return [line];
    const prefix = seenTitle ? ['', '---', ''] : [];
    seenTitle = true;
    return [...prefix, line];
  }).join('\n');
}

export function parseReport(report) {
  if (typeof report !== 'string' || !report.trim()) throw new ReportFormatError('Report is empty', '報告內容不可為空。');
  if (/^\s*(`{3,}|~{3,})/m.test(report)) throw new ReportFormatError('Code fences are not supported by this converter', '報告轉換不接受程式碼區塊。');
  return normalizeReportSeparators(report).trim().split(/^---\s*$/m).map((raw, index) => {
    const page = raw.trim();
    const number = index + 1;
    if (!/^#\s+\S/.test(page)) throw new ReportFormatError(`Page ${number} must start with a title`, `第 ${number} 頁需以 # 標題開始。`);
    const notes = [...page.matchAll(/^##[ \t]+(?:Speaker Notes|講者備忘|講者備註|講者筆記|講稿)[ \t]*$/gim)];
    const sources = [...page.matchAll(/^##[ \t]+(?:Sources|來源|來源連結|參考來源|參考資料)[ \t]*$/gim)];
    if (notes.length !== 1) throw new ReportFormatError(`Page ${number} needs one Speaker Notes section`, `第 ${number} 頁需有且只有一個講稿區塊（## Speaker Notes 或 ## 講稿）。`);
    if (sources.length > 1 || (sources.length && sources[0].index <= notes[0].index)) throw new ReportFormatError(`Page ${number} has invalid Sources placement`, `第 ${number} 頁的來源區塊可省略；如有提供，需置於講稿之後且不可重複。`);
    const body = page.slice(0, notes[0].index).trimEnd();
    const script = page.slice(notes[0].index + notes[0][0].length, sources[0]?.index ?? page.length).trim();
    const sourceSection = sources.length ? page.slice(sources[0].index).trim() : '';
    if (!script || /<!--|-->/.test(script)) throw new ReportFormatError(`Page ${number} has invalid speaker notes`, `第 ${number} 頁的講稿不可為空或包含 HTML 註解標記。`);
    if (sourceSection && !/^\s*-\s+\[[^\]]+\]\(https:\/\/[^\s)]+\)/m.test(sourceSection)) throw new ReportFormatError(`Page ${number} needs a source link`, `第 ${number} 頁如保留來源區塊，需提供 HTTPS Markdown 來源連結。`);
    return { body, script, sourceSection };
  });
}
