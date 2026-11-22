import { createOperation, readRequestJson, OperationError } from './operation.js';
import { inspectReport } from './quality.js';
import { createEvidenceCache } from './evidence-cache.js';
import { generateReport } from './index.js';
import { reviseReport } from './revision.js';
import { createClient } from './llm.js';
import { prepareEvidence as prepareState } from './evidence.js';
import { ConfigurationError, ModelOutputError, ProviderError, RepositorySelectionError, RevisionOutputError, GenerationOutputError } from './errors.js';
import { retrieveRepositoryContext, repositoryTrace, RepositoryContextError } from './repository-context.js';
import { MergeHistoryError } from './merge-history.js';
import { PublicRepositoryError, publicRepositoryClient } from './public-repository.js';

function failure(error, mode) {
  if (error instanceof PublicRepositoryError) return { status: error.status, code: error.code, retryable: error.status >= 500, error: `${error.message}草稿與修改要求已保留。` };
  if (error instanceof OperationError) {
    const messages = { OPERATION_CANCELLED: '本次操作已取消，原稿未變更。', OPERATION_TIMEOUT: '整次操作超過時間上限，原稿已保留。', MODEL_BUDGET_EXCEEDED: '已達本次模型請求上限，請縮小範圍後重試。', CONTEXT_TOO_LARGE: '本次證據與報告內容過長，請縮小區間或篇幅後重試。' };
    return { status: error.code === 'OPERATION_TIMEOUT' ? 504 : 422, code: error.code, retryable: false, error: messages[error.code] || '本次操作已停止，原稿已保留。' };
  }
  if (error.code === 'REQUIREMENTS_AMBIGUOUS') return { status: 400, code: error.code, retryable: false, error: error.message };
  if (error instanceof GenerationOutputError) {
    const messages = { GENERATION_REQUIREMENT_INVALID: '模型未滿足指定的頁數或語言要求。', GENERATION_JSON_INVALID: '模型未回傳有效的報告 JSON。', GENERATION_STRUCTURE_INVALID: '模型回傳的報告缺少章節資料。', GENERATION_CONTENT_INVALID: '模型回傳的章節內容格式不正確。', GENERATION_SOURCE_INVALID: '模型回傳的來源引用缺少資料，或未對應提供的證據。' };
    const fields = { title: '標題', script: '講稿', bullets: '重點', source_ids: '來源引用' };
    const detail = error.code === 'GENERATION_REQUIREMENT_INVALID' ? error.message : error.page ? `第 ${error.page} 節${fields[error.field] ? `的${fields[error.field]}` : ''}未通過檢查。` : '';
    return { status: 502, code: error.code, retryable: true, error: `${messages[error.code]}${detail}已請模型修正一次；目前草稿未變更。` };
  }
  if (error instanceof MergeHistoryError) return { status: 400, code: 'MERGE_RANGE_INVALID', retryable: false, error: '合併區間不正確或歷史資料不完整。開始版需早於或等於結束版，結束版需是目前所選快照；草稿已保留。' };
  if (error instanceof RepositorySelectionError) {
    const details = { SELECTION_JSON_INVALID: '選檔回覆不是有效的 JSON。', SELECTION_FORMAT_INVALID: '選檔格式或數量不符合限制。', SELECTION_PATH_INVALID: '選取的檔案不在此版本的清單中。', SELECTION_RANGE_INVALID: '選取的行號超出範圍、不是整數，或單段超過 180 行。', SELECTION_DUPLICATE_RANGE: '選取了重複的檔案範圍。', SELECTION_BUDGET_EXCEEDED: '選取內容超過 24,000 字元。' };
    const detail = details[error.code] || '模型選取的 repo 檔案或行號未通過檢查。';
    return { status: 502, code: 'REPOSITORY_SELECTION_INVALID', retryable: true, ...(details[error.code] ? { selectionIssue: error.code } : {}), error: `${detail}${error.correctionAttempts === 1 ? '已請模型修正一次，仍未通過檢查。' : ''}尚未生成或修改報告；草稿與修改要求已保留。可重試，或取消 repo 讀取後先依 Project State 與所選合併區間生成。` };
  }
  if (error instanceof RevisionOutputError) {
    if (error.code === 'REVISION_NO_EFFECT') return { status: 502, code: error.code, retryable: true, error: '模型未實際改寫報告，已請它修正一次，仍未提供有效變更。草稿保持原樣；可指定一段先改成白話，或直接手動編輯。' };
    const messages = { REVISION_REQUIREMENT_INVALID: '模型未滿足指定的頁數或語言要求。', REVISION_SCOPE_INVALID: '模型修改了要求範圍以外的頁面。', REVISION_STRUCTURE_INVALID: '修改後的頁面缺少講稿或分頁結構不完整；目前報告已保留。', REVISION_JSON_INVALID: '模型未回傳有效的修改 JSON。', REVISION_MATCH_FAILED: '模型指定的原文無法唯一對應目前報告。', REVISION_OVERLAP: '模型提出的修改區域互相重疊。', REVISION_SOURCE_INVALID: '模型新增的來源不在提供的證據中。', REVISION_TRANSLATION_INCOMPLETE: '模型未完整翻譯報告，仍留下明顯英文段落。' };
    return { status: 502, code: error.code, retryable: true, error: `${messages[error.code] || '模型修改未通過檢查。'}已嘗試修正一次；草稿未變更，修改要求已保留。` };
  }
  if (error instanceof RepositoryContextError) return { status: 422, code: 'REPOSITORY_CONTEXT_UNAVAILABLE', retryable: false, error: '無法讀取此版本的 repo 內容，請確認資料載入器與選取的 commit；可關閉 repo 讀取後先依 Project State 生成。草稿與修改要求已保留。' };
  if (error instanceof ConfigurationError) return { status: 500, code: 'MODEL_CONFIGURATION', retryable: false, error: '模型設定不完整或不正確。請確認伺服器的 LLM_PROVIDER，以及對應的 API Key 和模型名稱。' };
  if (error instanceof ModelOutputError && ['PROVIDER_RESPONSE_INCOMPLETE', 'PROVIDER_RESPONSE_EMPTY', 'PROVIDER_RESPONSE_INVALID'].includes(error.code)) {
    const messages = { PROVIDER_RESPONSE_INCOMPLETE: '模型未正常完成輸出，尚未進入報告格式檢查。可縮短篇幅或選擇較小的區間後重試。', PROVIDER_RESPONSE_EMPTY: '模型服務未回傳文字內容。', PROVIDER_RESPONSE_INVALID: '模型服務的回應不是有效的 JSON。' };
    return { status: 502, code: error.code, retryable: true, error: `${messages[error.code]}本次未自動重送，草稿與修改要求已保留。` };
  }
  if (error instanceof ModelOutputError) return { status: 502, code: 'MODEL_OUTPUT_INVALID', retryable: true, error: mode === 'revise' ? '模型回覆未符合修改格式，或無法精確套用。草稿未變更；可將修改要求拆成較小範圍，或直接手動編輯。' : '模型回覆的報告格式不完整或未通過來源檢查。請重新生成；目前草稿未變更。' };
  if (error instanceof ProviderError && error.kind === 'timeout') return { status: 504, code: 'PROVIDER_TIMEOUT', retryable: true, error: '模型回覆逾時，這次請求沒有自動重送。草稿與修改要求已保留，請稍後重試。' };
  if (error instanceof ProviderError && error.kind === 'network') return { status: 502, code: 'PROVIDER_NETWORK', retryable: true, error: '無法連線到模型服務。請確認網路後重試；草稿與修改要求已保留。' };
  const status = error instanceof ProviderError ? error.status : Number(/HTTP (\d{3})/.exec(error.message)?.[1]);
  if ([500, 502, 503, 504].includes(status)) {
    const attempts = error instanceof ProviderError ? `，已嘗試 ${error.attempts} 次` : '';
    return { status: 502, code: 'PROVIDER_UNAVAILABLE', retryable: true, error: `模型服務暫時忙碌或無法使用（HTTP ${status}${attempts}）。請稍後重試；若持續發生，請在供應商確認目前可用的模型。草稿與修改要求已保留。` };
  }
  if (status === 429) return { status: 429, code: 'PROVIDER_RATE_LIMIT', retryable: false, error: '模型服務回報請求頻率或額度限制（HTTP 429）。請在供應商確認限制，等待恢復後再試；草稿已保留。' };
  if ([401, 403].includes(status)) return { status: 502, code: 'PROVIDER_AUTH', retryable: false, error: `模型服務拒絕存取（HTTP ${status}）。請確認伺服器的 API Key 與專案權限。` };
  if (status === 404) return { status: 502, code: 'PROVIDER_MODEL_NOT_FOUND', retryable: false, error: '指定的模型不存在或目前專案無法使用（HTTP 404）。請確認伺服器的模型名稱。' };
  return { status: 502, code: 'REPORT_REQUEST_FAILED', retryable: false, error: '報告請求未完成。草稿與修改要求已保留；請回報此錯誤代碼以便排查。' };
}

// Local integration endpoint. Authentication and persistence are separate work.
export function reportHandler(mode, { complete, retrieveContext = retrieveRepositoryContext, loadHistory = async () => { throw new MergeHistoryError('No history loader configured'); }, publicClient = publicRepositoryClient, production = process.env.NODE_ENV === 'production' } = {}) {
  const cachedEvidence = createEvidenceCache();
  return async function POST(request) {
    if (production) return Response.json({ error: '報告 API 目前僅供本機開發使用。' }, { status: 403 });
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return Response.json({ error: '不允許跨來源請求。' }, { status: 403 });
    let body;
    try {
      body = await readRequestJson(request, 500_000);
      prepareState(body.state);
      if ((body.useRepository !== undefined && typeof body.useRepository !== 'boolean') || (body.focus !== undefined && (typeof body.focus !== 'string' || body.focus.length > 4000)) || body.repository_context !== undefined || body.merge_history !== undefined || (body.mergeRange !== undefined && (!body.mergeRange || typeof body.mergeRange.startCommit !== 'string' || typeof body.mergeRange.endCommit !== 'string'))) throw new Error('Invalid repository options');
      if (mode === 'revise' && (typeof body.report !== 'string' || !body.report.trim() || body.report.length > 100_000 || typeof body.request !== 'string' || !body.request.trim() || body.request.length > 4000 || !Array.isArray(body.history) || body.history.length > 100 || body.history.some(turn => !turn || !['user', 'assistant'].includes(turn.role) || typeof turn.content !== 'string' || turn.content.length > 8000))) throw new Error('Invalid revision');
    } catch (error) {
      if (error.code === 'REQUEST_TOO_LARGE') return Response.json({ error: 'Request too large.' }, { status: 413 });
      return Response.json({ error: '報告、修改要求或 Project State 格式不正確。' }, { status: 400 });
    }
    let stage = 'preparation';
    const operation = createOperation({ signal: request.signal });
    try {
      const remote = body.state.evidence_kind === 'repository_snapshot' ? publicClient({ signal: operation.signal }) : null;
      if (remote) {
        if (body.mergeRange) throw new PublicRepositoryError('MERGE_RANGE_UNAVAILABLE', 'Repo 現況模式沒有歷史快照區間。', 400);
        // Rebuild metadata on the server; never trust client-submitted assessments.
        body.state = await remote.resolve(body.state.repository.url, body.state.source_commit_sha);
      }
      const mergeHistory = body.mergeRange ? await loadHistory(body.state, body.mergeRange) : undefined;
      const client = operation.wrap(complete ?? createClient({ signal: operation.signal, onUsage: operation.record }));
      stage = 'repository_selection';
      const selectionArgs = { state: body.state, mode, request: mode === 'revise' ? body.request : body.focus || '', report: mode === 'revise' ? body.report : '', history: mode === 'revise' ? body.history : [] };
      let repositoryContext, evidenceCacheHit = false;
      if (body.useRepository) {
        const load = () => remote
          ? retrieveRepositoryContext(selectionArgs, { complete: client, loadSnapshot: remote.loadSnapshot })
          : retrieveContext(selectionArgs, { complete: client });
        const provider = process.env.LLM_PROVIDER || 'openai';
        const model = process.env[({ gemini: 'GEMINI_MODEL', groq: 'GROQ_MODEL', openai: 'OPENAI_MODEL' })[provider]];
        const selected = complete ? { context: await load(), hit: false } : await cachedEvidence({ ...selectionArgs, version: 'selection-v2', provider, model }, load);
        repositoryContext = selected.context; evidenceCacheHit = selected.hit;
      }
      stage = mode === 'revise' ? 'report_revision' : 'report_generation';
      const result = mode === 'revise'
        ? await reviseReport(body, { complete: client, repositoryContext, mergeHistory })
        : { report: await generateReport(body.state, { complete: client, repositoryContext, mergeHistory, focus: body.focus || '' }) };
      const quality = /^#\s+\S/m.test(result.report) ? inspectReport(result.report, { state: body.state, repositoryContext, mergeHistory, request: mode === 'revise' ? body.request : body.focus || '' }) : undefined;
      if (quality && result.historyOmittedTurns) quality.warnings.push({ code: 'HISTORY_TRIMMED', page: 1, message: `為控制上下文，已省略 ${result.historyOmittedTurns} 則較早對話；如修改要求依賴舊指示，請重述必要內容。` });
      return Response.json({ ...result, quality, operation: operation.stats(), ...(repositoryContext ? { repository: { ...repositoryTrace(repositoryContext), cached: evidenceCacheHit } } : {}), ...(mergeHistory ? { mergeRange: { startCommit: mergeHistory.start_commit, endCommit: mergeHistory.end_commit, count: mergeHistory.merges.length } } : {}) }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      const { status, ...body } = failure(error, mode);
      return Response.json({ ...body, stage, operation: operation.stats() }, { status, headers: { 'Cache-Control': 'no-store' } });
    }
  };
}
