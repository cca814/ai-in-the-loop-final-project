'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { parseRecentProjects, readRecentProjects, rememberProject, subscribeRecentProjects } from './recent-projects';
import RevisionReview from './revision-review';
import { inspectReport } from '../../report-agent/quality.js';
import MarkdownEditor from './markdown-editor';
import type { WorkspaceDataset } from './workspace-types';
import './workspace.css';

// Keep the revision implementation for later work; the walking skeleton has no chat entry point.
const conversationEnabled = false;
const draftStorageEnabled = false;
const defaultReportFocus = '先說明整份專案的用途與整體架構，再呈現近期成果與待處理問題。';

type Quality = { pageCount: number; estimatedSpeakingSeconds: number; warnings: { code: string; page: number; message: string }[]; provenance: unknown };
type OperationStats = { modelCalls: number; durationMs: number; inputTokens: number; outputTokens: number; httpAttempts: number };
type SavedVersion = { report: string; history: Turn[]; quality: Quality | null; label: string };
type Proposal = { report: string; message: string; quality: Quality | null; request: string; base: string; repository: RepositoryTrace | null };
type LayoutResult = { markdown: string; checkedPages: number; overflowPages: { page: number; overflowX: boolean; overflowY: boolean }[] };
type Turn = { role: 'user' | 'assistant'; content: string };
type PresentationPlan = { pages: { transition: string; layout: string; reveal: boolean; clickAnimation: string }[] };
type SlideBundle = { generatedMarkdown: string; markdown: string; report: string; transition: string; presentationPlan?: PresentationPlan };
type WebDeck = { url: string; expiresAt: string; report: string; transition: string };
type RepositoryTrace = { commit: string; cached?: boolean; status: 'read' | 'not_needed'; inventory?: { directories: string[]; complete: boolean; url: string }; files: { path: string; start_line: number; end_line: number; url: string }[] };

type StoredDraft = { report: string; history: Turn[]; focus: string; request: string; revision: number; updatedAt: string; mergeRange?: { startCommit: string; endCommit: string } };
async function storageRequest(body?: object, query = ''): Promise<{ projectId?: string; states?: unknown[]; datasets?: WorkspaceDataset[]; draft?: StoredDraft | null }> {
  const response = await fetch(`/api/reports/storage${query}`, { method: body ? 'POST' : 'GET', cache: 'no-store', signal: AbortSignal.timeout(15_000), ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Mock 儲存請求失敗。');
  return result;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Dataset providers return snapshots in version order (oldest to newest).
function latestSnapshot(dataset: WorkspaceDataset) {
  return dataset.snapshots[dataset.snapshots.length - 1];
}

export default function ReportWorkspace({ datasets }: { datasets: WorkspaceDataset[] }) {
  const [remoteDataset, setRemoteDataset] = useState<WorkspaceDataset | null>(null);
  const [mockDatasets, setMockDatasets] = useState<WorkspaceDataset[]>([]);
  const [mockLoadVersion, setMockLoadVersion] = useState(0);
  const [projectId, setProjectId] = useState('');
  const recentProjects = parseRecentProjects(useSyncExternalStore(subscribeRecentProjects, readRecentProjects, () => '[]'));
  const [projectLoadMessage, setProjectLoadMessage] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [loadingRepo, setLoadingRepo] = useState(false);
  const [importError, setImportError] = useState('');
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const available = [...(remoteDataset ? [remoteDataset] : []), ...mockDatasets, ...datasets].filter(dataset => dataset.snapshots.length > 0);
  async function loadProjectStates(event: React.SyntheticEvent) {
    event.preventDefault();
    if (loadingRepo || workspaceBusy) return;
    if (hasDraft && !window.confirm('載入專案會清除目前報告，請先下載。確定繼續？')) return;
    setLoadingRepo(true); setImportError(''); setProjectLoadMessage('');
    try {
      const id = projectId.trim();
      const result = await storageRequest(undefined, `?${new URLSearchParams({ projectId: id })}`);
      if (result.projectId !== id || !result.states?.length || !result.datasets?.length) throw new Error('專案 States 回應不完整。');
      setRemoteDataset(null); setMockDatasets(result.datasets); setMockLoadVersion(previous => previous + 1); setHasDraft(false);
      setProjectLoadMessage(`已載入專案 ${id} 的全部 ${result.states.length} 版 State。`);
      rememberProject(id);
    } catch (cause) { setImportError(cause instanceof Error ? cause.message : '專案載入失敗。'); }
    finally { setLoadingRepo(false); }
  }
  async function loadMock(seed = false, input?: WorkspaceDataset) {
    if (loadingRepo || workspaceBusy) return;
    if (hasDraft && !window.confirm('載入資料會清除目前頁面的編輯內容，請先下載報告。確定繼續？')) return;
    setLoadingRepo(true); setImportError('');
    try {
      if (input) await storageRequest({ action: 'dataset', dataset: input });
      const result = seed ? await storageRequest({ action: 'seed' }) : await storageRequest();
      if (!result.datasets?.length) throw new Error('尚無 Mock 資料，請先建立範例或匯入 Project State。');
      setRemoteDataset(null); setMockDatasets(result.datasets); setMockLoadVersion(previous => previous + 1); setHasDraft(false);
    } catch (cause) { setImportError(cause instanceof Error ? cause.message : 'Mock 載入失敗。'); }
    finally { setLoadingRepo(false); }
  }
  async function importRepository(event: React.SyntheticEvent, historyMode = false) {
    event.preventDefault();
    if (loadingRepo || workspaceBusy) return;
    if (hasDraft && !window.confirm('載入 repo 會清除目前草稿，請先下載報告。確定繼續？')) return;
    setLoadingRepo(true); setImportError('');
    try {
      const response = await fetch(historyMode ? '/api/reports/history' : '/api/reports/repository', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(50_000), body: JSON.stringify({ url: repoUrl.trim() }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '無法載入 repo。');
      if (historyMode) {
        if (!result.dataset?.replayId || !result.dataset.snapshots?.length) throw new Error('歷史資料回應不完整。');
        setRemoteDataset({ ...result.dataset, id: `${result.dataset.id}-${Date.now()}` });
      } else {
        if (result.state?.evidence_kind !== 'repository_snapshot' || !result.state.source_commit_sha) throw new Error('Repo 回應不完整。');
        const state = result.state;
        setRemoteDataset({ id: `public-${state.repository.full_name}-${state.source_commit_sha}-${Date.now()}`, label: `公開 repo · ${state.repository.full_name}`, supportsRepository: true, snapshots: [{ id: state.event_id, label: `目前版本 · ${state.source_commit_sha.slice(0, 12)}`, state }] });
      }
      setHasDraft(false);
    } catch (cause) { setImportError(cause instanceof Error ? cause.message : '無法載入 repo。'); }
    finally { setLoadingRepo(false); }
  }
  return <><section className="reports-importBox"><div className="reports-card"><h2>本機 Mock Firebase</h2><p className="reports-caption">模擬以 project ID 取得該專案的所有 Project State，不會連線 Firebase。生成報告仍使用原有的 LLM 設定。</p><form onSubmit={loadProjectStates}>{recentProjects.length > 0 && <><label className="reports-label" htmlFor="recent-project-id">最近載入的 Project ID</label><select id="recent-project-id" value={recentProjects.includes(projectId) ? projectId : ''} disabled={loadingRepo || workspaceBusy} onChange={event => setProjectId(event.target.value)}><option value="">選擇曾載入的專案</option>{recentProjects.map(id => <option key={id} value={id}>{id}</option>)}</select><p className="reports-caption">保留最近 10 個成功載入的 ID，僅存在此瀏覽器；選取後按下方按鈕載入。</p></>}<label className="reports-label" htmlFor="mock-project-id">Project ID</label><input id="mock-project-id" required maxLength={63} pattern="[a-z0-9][a-z0-9-]{1,62}" value={projectId} onChange={event => setProjectId(event.target.value)} disabled={loadingRepo || workspaceBusy} placeholder="填入 State 的 project_id" /><div className="reports-exportActions"><button className="reports-primary" disabled={loadingRepo || workspaceBusy || !projectId.trim()}>載入專案 States</button></div></form>{projectLoadMessage && <p role="status">{projectLoadMessage}</p>}<details open><summary>Mock 測試資料管理</summary><div className="reports-exportActions"><button type="button" className="reports-primary" disabled={loadingRepo || workspaceBusy} onClick={() => loadMock()}>載入 Mock 資料</button><button type="button" className="reports-secondary" disabled={loadingRepo || workspaceBusy} onClick={() => loadMock(true)}>建立 Mock 範例資料</button><label className="reports-label">匯入 Project State JSON<input type="file" accept=".json,application/json" disabled={loadingRepo || workspaceBusy} onChange={async event => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    try { if (file.size > 1_500_000) throw new Error('JSON 檔案過大。'); const state = JSON.parse(await file.text()); await loadMock(false, { id: 'import', label: state.project_name || '匯入的 Project State', snapshots: [{ id: state.event_id, label: state.event_id, state }] }); }
    catch { setImportError('無法匯入 JSON，請確認檔案格式。'); }
  }} /></label></div></details></div></section><section className="reports-importBox"><form className="reports-card" onSubmit={event => importRepository(event)}><label className="reports-label" htmlFor="public-repository-url">公開 GitHub repo 網址</label><input id="public-repository-url" type="url" required maxLength={300} value={repoUrl} onChange={event => setRepoUrl(event.target.value)} disabled={loadingRepo || workspaceBusy} placeholder="https://github.com/owner/repo" /><div className="reports-exportActions"><button className="reports-primary" disabled={loadingRepo || workspaceBusy}>{loadingRepo ? '正在載入 repo…' : '載入公開 repo'}</button><button type="button" className="reports-secondary" disabled={loadingRepo || workspaceBusy || !repoUrl.trim()} onClick={event => importRepository(event, true)}>載入已重建的歷史 State</button></div><p className="reports-caption">「載入公開 repo」取得目前程式碼現況，不包含歷史。「載入已重建的歷史 State」讀取本機 state-replay 工具已驗證的逐版結果，可選版本與最多 100 次合併的報告區間。兩個載入動作都不呼叫 LLM。</p><p className="reports-caption">歷史重建先在 state-replay 執行 cli.js；每版根據上一版 State、當次合併與程式碼分析，結果為部分歷史重建，仍須人工核對。這裡不會自動啟動長時間的重建工作。</p>{importError && <p role="alert">{importError}</p>}</form></section>{available.length > 0 && <ReportWorkspaceContent key={remoteDataset?.id || `sources-${mockLoadVersion}`} datasets={available} onBusyChange={setWorkspaceBusy} onDraftChange={setHasDraft} externalBusy={loadingRepo} />}</>;
}

function ReportWorkspaceContent({ datasets, onBusyChange, onDraftChange, externalBusy }: { datasets: WorkspaceDataset[]; onBusyChange: (busy: boolean) => void; onDraftChange: (draft: boolean) => void; externalBusy: boolean }) {
  const [datasetId, setDatasetId] = useState(datasets[0].id);
  const [snapshotId, setSnapshotId] = useState(latestSnapshot(datasets[0]).id);
  const [report, setReport] = useState('');
  const [splitEditor, setSplitEditor] = useState(false);
  const [history, setHistory] = useState<Turn[]>([]);
  const [request, setRequest] = useState('');
  const [focus, setFocus] = useState(defaultReportFocus);
  const [useRepository, setUseRepository] = useState(!!datasets[0].supportsRepository);
  const [mergeRangeEnabled, setMergeRangeEnabled] = useState(false);
  const [rangeStartIndex, setRangeStartIndex] = useState(0);
  const [repositoryTrace, setRepositoryTrace] = useState<RepositoryTrace | null>(null);
  const [pending, setPending] = useState<'generate' | 'revise' | 'slides' | 'export' | 'web' | 'portable' | 'layout' | 'storage' | null>(null);
  const [layoutResult, setLayoutResult] = useState<LayoutResult | null>(null);
  const [presentationKind, setPresentationKind] = useState('web');
  const [webDeck, setWebDeck] = useState<WebDeck | null>(null);
  const [transition, setTransition] = useState('auto');
  const [format, setFormat] = useState('pptx');
  const [confirmedReport, setConfirmedReport] = useState('');
  const [slideBundle, setSlideBundle] = useState<SlideBundle | null>(null);
  const [error, setError] = useState('');
  const [quality, setQuality] = useState<Quality | null>(null);
  const [operationStats, setOperationStats] = useState<OperationStats | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [reviewChanges, setReviewChanges] = useState(true);
  const [undoStack, setUndoStack] = useState<SavedVersion[]>([]);
  const [redoStack, setRedoStack] = useState<SavedVersion[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [storageRevision, setStorageRevision] = useState(0);
  const [storageMessage, setStorageMessage] = useState('');
  const activeOperation = useRef<AbortController | null>(null);
  const manualCheckpoint = useRef(false);
  const [notice, setNotice] = useState('選擇資料後，生成第一份報告。');
  const dataset = datasets.find(item => item.id === datasetId)!;
  const snapshotIndex = dataset.snapshots.findIndex(item => item.id === snapshotId);
  const state = dataset.snapshots[snapshotIndex].state;
  const repoOnly = state.evidence_kind === 'repository_snapshot';
  const historical = !!dataset.supportsHistory;
  const effectiveRangeStart = Math.max(Math.min(rangeStartIndex, snapshotIndex), snapshotIndex - 99);
  const mergeRange = historical && mergeRangeEnabled ? { startCommit: dataset.snapshots[effectiveRangeStart].state.source_commit_sha, endCommit: state.source_commit_sha } : undefined;
  const triggerSource = state.source_refs.find(ref => ref.id === state.trigger.source_ref_id);
  const slidesCurrent = !!slideBundle && slideBundle.report === report && slideBundle.transition === transition;
  const webCurrent = !!webDeck && webDeck.report === report && webDeck.transition === transition;
  const automaticInspection = useMemo(() => {
    if (!report.trim()) return { quality: null, error: '' };
    try { return { quality: inspectReport(report, { state, request: focus }), error: '' }; }
    catch (cause) {
      const message = cause && typeof cause === 'object' && 'publicMessage' in cause && typeof cause.publicMessage === 'string'
        ? cause.publicMessage : '報告的頁面或講稿格式不完整，請補齊後再產生簡報。';
      return { quality: null, error: message };
    }
  }, [report, state, focus]);

  useEffect(() => { onBusyChange(!!pending); }, [pending, onBusyChange]);
  useEffect(() => { onDraftChange(!!report.trim()); }, [report, onDraftChange]);


  useEffect(() => {
    if (!report.trim()) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [report]);
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setElapsed(previous => previous + 1), 1000);
    return () => clearInterval(timer);
  }, [pending]);
  useEffect(() => () => activeOperation.current?.abort(), []);

  function remember(label: string) {
    if (report) setUndoStack(previous => [...previous.slice(-19), { report, history, quality, label }]);
    setRedoStack([]);
    manualCheckpoint.current = false;
  }
  function manualEdit(next: string) {
    if (!manualCheckpoint.current) { remember('Manual edit'); manualCheckpoint.current = true; }
    setReport(next); setQuality(null); setProposal(null);
  }
  function restoreVersion(direction: 'undo' | 'redo') {
    const stack = direction === 'undo' ? undoStack : redoStack;
    const version = stack.at(-1);
    if (!version || pending) return;
    const current = { report, history, quality, label: direction === 'undo' ? 'Redo' : 'Undo' };
    if (direction === 'undo') { setUndoStack(stack.slice(0, -1)); setRedoStack(previous => [...previous.slice(-19), current]); }
    else { setRedoStack(stack.slice(0, -1)); setUndoStack(previous => [...previous.slice(-19), current]); }
    setReport(version.report); setHistory(version.history); setQuality(version.quality); setProposal(null); setConfirmedReport(''); setNotice('已還原報告與對話版本。'); manualCheckpoint.current = false;
  }
  function beginOperation(kind: NonNullable<typeof pending>) {
    const controller = new AbortController(); activeOperation.current = controller;
    setPending(kind); setElapsed(0); setOperationStats(null); setNotice('');
    return controller;
  }
  function operationError(cause: unknown, fallback: string) {
    if (cause instanceof Error && cause.name === 'AbortError') return '操作已取消，目前草稿已保留。';
    if (cause instanceof Error && cause.name === 'TimeoutError') return '操作超過時間上限，目前草稿已保留。';
    return cause instanceof Error ? cause.message : fallback;
  }
  function finishOperation(controller: AbortController) {
    if (activeOperation.current === controller) { activeOperation.current = null; setPending(null); }
  }
  function acceptProposal() {
    if (!proposal || proposal.base !== report) { setProposal(null); return; }
    remember('Before revision');
    setReport(proposal.report); setQuality(proposal.quality);
    setRepositoryTrace(proposal.repository);
    setHistory(previous => [...previous, { role: 'user', content: proposal.request }, { role: 'assistant', content: proposal.message }]);
    setRequest(''); setProposal(null); setNotice('修改已確認並套用，可用復原返回上一版。');
  }

  async function inspectSlideLayout() {
    if (pending || !slidesCurrent || !slideBundle) return;
    const controller = beginOperation('layout'); setError('');
    try {
      const response = await fetch('/api/reports/layout', { method: 'POST', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report: slideBundle.report, slides: slideBundle.markdown, transition: slideBundle.transition, presentationPlan: slideBundle.presentationPlan }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '無法檢查投影片版面。');
      if (!Number.isInteger(result.checkedPages) || !Array.isArray(result.overflowPages)) throw new Error('版面檢查回覆格式不符。');
      setLayoutResult({ ...result, markdown: slideBundle.markdown });
      setNotice('版面檢查完成，請查看結果；報告內容未變更。');
    } catch (cause) { setError(operationError(cause, '無法檢查投影片版面。')); }
    finally { finishOperation(controller); }
  }

  function changeSnapshot(nextDataset: string, value: string) {
    if (nextDataset === datasetId && value === snapshotId) return;
    if (report && !window.confirm('切換資料會清除目前報告。請先下載報告。是否繼續？')) return;
    setDatasetId(nextDataset);
    if (nextDataset !== datasetId) { setUseRepository(!!datasets.find(item => item.id === nextDataset)?.supportsRepository); setFocus(defaultReportFocus); setMergeRangeEnabled(false); setRangeStartIndex(0); }
    else setRangeStartIndex(previous => Math.min(previous, dataset.snapshots.findIndex(item => item.id === value)));
    setSnapshotId(value);
    setStorageRevision(0); setStorageMessage('');
    setReport('');
    setHistory([]);
    setRequest('');
    setError('');
    setSlideBundle(null);
    setWebDeck(null);
    setConfirmedReport('');
    setRepositoryTrace(null); setQuality(null); setProposal(null); setUndoStack([]); setRedoStack([]); manualCheckpoint.current = false;
    setNotice('已切換資料，可以生成新報告。');
  }

  async function run(mode: 'generate' | 'revise') {
    if (pending || (mode === 'revise' && (!conversationEnabled || proposal))) return;
    if (mode === 'generate' && report && !window.confirm('重新生成會取代目前報告，是否繼續？')) return;
    const controller = beginOperation(mode);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/reports/${mode}`, {
        method: 'POST', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'generate' ? { state, replayId: dataset.replayId, mockDatasetId: dataset.mockId, focus, mergeRange, useRepository: !!dataset.supportsRepository && useRepository } : { state, replayId: dataset.replayId, mockDatasetId: dataset.mockId, report, request, history, mergeRange, useRepository: !!dataset.supportsRepository && useRepository }),
      });
      const result = await response.json();
      setOperationStats(result.operation || null);
      if (!response.ok) {
        const stages: Record<string, string> = { repository_selection: 'Repo 選檔階段：', report_generation: '報告生成階段：', report_revision: '報告修改階段：' };
        throw new Error(`${stages[result.stage] || ''}${result.error || '請求失敗，請稍後重試。'}${result.code ? ` [${result.code}]` : ''}`);
      }
      if (typeof result.report !== 'string' || !result.report.trim()) throw new Error('伺服器回傳的報告為空或格式不正確。');
      setOperationStats(result.operation || null);
      if (mode === 'revise' && reviewChanges && result.report !== report) {
        setProposal({ report: result.report, base: report, request, message: result.message || '請確認這次修改。', quality: result.quality || null, repository: result.repository || null });
        setNotice('修改建議已產生，請確認差異後再接受；原稿尚未變更。');
        return;
      }
      remember(mode === 'generate' ? 'Before generation' : 'Before revision');
      setReport(result.report); setQuality(result.quality || null); setProposal(null);
      setRepositoryTrace(result.repository || null);
      if (mode === 'generate') {
        setHistory([]);
        setNotice('報告已生成。你可以直接編輯，再確認內容並產生簡報。請下載需要保留的報告。');
      } else {
        const changed = result.report !== report;
        setHistory(previous => [...previous, { role: 'user', content: request }, { role: 'assistant', content: result.message || (changed ? '報告已更新。' : '模型未對報告提出修改。') }]);
        setRequest('');
        setNotice(changed ? '修改已套用至目前報告。' : '本次未修改報告，請查看對話回覆。');
      }
    } catch (cause) {
      setError(operationError(cause, '請求失敗，請稍後重試。'));
      setNotice(report.trim() ? '本次請求未完成，目前報告已保留。' : '本次尚未產生報告，請稍後重試。');
    } finally {
      finishOperation(controller);
    }
  }

  function download() {
    saveBlob(new Blob([report], { type: 'text/markdown;charset=utf-8' }), `${state.project_id}-${state.event_id}-report.md`);
    setNotice('已下載目前的 Markdown 報告。');
  }

  async function persistDraft(load: boolean) {
    if (!draftStorageEnabled || pending || !dataset.mockId) return;
    if (load && report.trim() && !window.confirm('載入會取代目前報告與需求。是否繼續？')) return;
    const controller = beginOperation('storage'); setError('');
    try {
      const result = load
        ? await storageRequest(undefined, `?${new URLSearchParams({ datasetId: dataset.mockId, snapshotId: state.event_id })}`)
        : await storageRequest({ action: 'save', datasetId: dataset.mockId, snapshotId: state.event_id, expectedRevision: storageRevision, draft: { report, history, focus, request, mergeRange } });
      if (!result.draft) { setStorageMessage('此快照尚無已存草稿。'); return; }
      if (load) {
        remember('Before loading saved draft');
        setReport(result.draft.report); setHistory(result.draft.history); setFocus(result.draft.focus); setRequest(result.draft.request);
        const savedRange = result.draft.mergeRange;
        setMergeRangeEnabled(!!savedRange && !!dataset.supportsHistory);
        setRangeStartIndex(savedRange ? Math.max(0, dataset.snapshots.findIndex(item => item.state.source_commit_sha === savedRange.startCommit)) : 0);
        setProposal(null); setQuality(null); setConfirmedReport(''); setSlideBundle(null); setWebDeck(null); setRepositoryTrace(null); setLayoutResult(null);
      }
      setStorageRevision(result.draft.revision);
      setStorageMessage(`${load ? '已載入' : '已儲存'}第 ${result.draft.revision} 版 · ${new Date(result.draft.updatedAt).toLocaleString()}`);
      setNotice(load ? '報告草稿已還原。' : '草稿已存入本機 Mock 資料檔。');
    } catch (cause) { setError(operationError(cause, 'Mock 儲存操作失敗，目前編輯內容已保留。')); }
    finally { finishOperation(controller); }
  }

  async function generateSlides() {
    if (pending || !report.trim() || confirmedReport !== report) return;
    if (slideBundle && slideBundle.markdown !== slideBundle.generatedMarkdown && !window.confirm('重新產生會取代手動編輯的 slides.md，請先下載需要保留的原稿。確定繼續？')) return;
    const controller = beginOperation('slides');
    setError('');
    try {
      const response = await fetch('/api/reports/slides', { method: 'POST', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report, transition }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '無法產生 Slidev 原稿。');
      if (typeof result.slides !== 'string') throw new Error('簡報原稿格式不正確。');
      if (transition === 'auto' && (!result.presentationPlan || !Array.isArray(result.presentationPlan.pages))) throw new Error('模型未回傳有效的簡報特效設定。');
      setOperationStats(result.operation || null);
      setSlideBundle({ generatedMarkdown: result.slides, markdown: result.slides, report, transition, presentationPlan: result.presentationPlan });
      setWebDeck(null);
      setNotice('Slidev 原稿已產生，可以建立網頁簡報或下載。');
    } catch (cause) {
      setError(operationError(cause, '無法產生簡報。'));
    } finally { finishOperation(controller); }
  }

  async function downloadPptx() {
    if (pending || !slidesCurrent || !slideBundle) return;
    const controller = beginOperation('export');
    setError('');
    try {
      const response = await fetch('/api/reports/export', { method: 'POST', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report: slideBundle.report, slides: slideBundle.markdown, transition: slideBundle.transition, presentationPlan: slideBundle.presentationPlan, format }) });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'PPTX 匯出失敗。');
      }
      saveBlob(await response.blob(), `${state.project_id}-${state.event_id}-${format}.pptx`);
      setNotice('PPTX 已下載。');
    } catch (cause) {
      setError(operationError(cause, 'PPTX 匯出失敗。'));
    } finally { finishOperation(controller); }
  }

  async function createWebDeck() {
    if (pending || !slidesCurrent || !slideBundle) return;
    const controller = beginOperation('web');
    setError('');
    try {
      const response = await fetch('/api/reports/web', { method: 'POST', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report: slideBundle.report, slides: slideBundle.markdown, transition: slideBundle.transition, presentationPlan: slideBundle.presentationPlan }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '無法建立網頁簡報。');
      if (typeof result.url !== 'string' || !result.url.startsWith('/api/reports/present/') || typeof result.expiresAt !== 'string') throw new Error('網頁簡報連結格式不正確。');
      setWebDeck({ url: result.url, expiresAt: result.expiresAt, report: slideBundle.report, transition: slideBundle.transition });
      setNotice('網頁簡報已就緒，請按「開啟播放」在新分頁播放。');
    } catch (cause) {
      setError(operationError(cause, '無法建立網頁簡報。'));
    } finally { finishOperation(controller); }
  }

  async function downloadPortable() {
    if (pending || !slidesCurrent || !slideBundle) return;
    const controller = beginOperation('portable');
    setError('');
    try {
      const response = await fetch('/api/reports/portable', { method: 'POST', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report: slideBundle.report, slides: slideBundle.markdown, transition: slideBundle.transition, presentationPlan: slideBundle.presentationPlan }) });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || '可攜式簡報匯出失敗。');
      }
      saveBlob(await response.blob(), `${state.project_id}-${state.event_id}-portable.zip`);
      setNotice('可攜式簡報已下載。請解壓縮後執行 start.cmd，並開啟顯示的網址。');
    } catch (cause) {
      setError(operationError(cause, '可攜式簡報匯出失敗。'));
    } finally { finishOperation(controller); }
  }

  return (
    <main className="reports-workspace" inert={externalBusy}>
      <header className="reports-header">
        <div><p className="reports-brand">BRIDGING CODE AND INTENT</p><h1>專案進度報告</h1><p className="reports-subtitle">從專案現況整理報告，讓每一次修改都有依據。</p></div>
        <span className="reports-badge">本機測試 · {dataset.label}</span>
      </header>
      <div className="reports-banner">目前草稿只保留在此頁面，重新整理後會清除。請下載需要保留的報告。</div>
      <div className={`reports-grid${splitEditor ? ' reports-gridSplit' : ''}${conversationEnabled ? '' : ' reports-gridWithoutChat'}`}>
        <section className="reports-card" aria-labelledby="state-title">
          <p className="reports-eyebrow">{repoOnly ? 'REPOSITORY SNAPSHOT' : 'PROJECT STATE'}</p><h2 id="state-title">報告的資料來源</h2>
          <label className="reports-label" htmlFor="state-dataset">選擇專案資料</label>
          <select id="state-dataset" value={datasetId} disabled={!!pending} onChange={event => {
            const next = datasets.find(item => item.id === event.target.value)!;
            changeSnapshot(next.id, latestSnapshot(next).id);
          }}>{datasets.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select>
          <p className="reports-caption" role="status">{snapshotIndex === dataset.snapshots.length - 1 ? '目前使用最新狀態' : '目前使用歷史版本'} · {dataset.snapshots[snapshotIndex].label}</p>
          {snapshotIndex !== dataset.snapshots.length - 1 && <button type="button" className="reports-secondary" disabled={!!pending} onClick={() => changeSnapshot(datasetId, latestSnapshot(dataset).id)}>回到最新狀態</button>}
          {(dataset.snapshots.length > 1 || historical) && <details id="state-history" className="reports-details">
          <summary>歷史版本／報告區間</summary>
          <p className="reports-caption">已保留 {dataset.snapshots.length} 版狀態。一般匯報直接使用最新狀態；需要回顧時再選擇舊版。單份 State 描述當時現況，不包含完整的歷次變更。</p>
          <label className="reports-label reports-snapshotLabel" htmlFor="state-snapshot">{historical ? '選擇合併快照' : '選擇歷史版本'}</label>
          <select id="state-snapshot" value={snapshotId} disabled={!!pending} onChange={event => changeSnapshot(datasetId, event.target.value)}>
            {dataset.snapshots.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
          </select>
          {historical && <>
            <div className="reports-snapshotNavigation"><button className="reports-secondary" disabled={!!pending || snapshotIndex === 0} onClick={() => changeSnapshot(datasetId, dataset.snapshots[snapshotIndex - 1].id)}>上一版</button><span>{snapshotIndex + 1} / {dataset.snapshots.length}</span><button className="reports-secondary" disabled={!!pending || snapshotIndex === dataset.snapshots.length - 1} onClick={() => changeSnapshot(datasetId, dataset.snapshots[snapshotIndex + 1].id)}>下一版</button></div>
            <p className="reports-caption">{dataset.mockId ? '各版 State 與實際合併時間紀錄已對應。版本選單顯示 State 的資料時間；區間報告另提供各次合併的時間、摘要與來源。' : '每版對應一次合併後的專案狀態，依合併時間排序。選單日期是合併時間；State 的資料建置時間另列。'} 歷史資料不等於完整決策紀錄，未記錄的原因不會自行推測。</p>
            <label className="reports-confirm"><input type="checkbox" checked={mergeRangeEnabled} disabled={!!pending} onChange={event => setMergeRangeEnabled(event.target.checked)} />彙整合併區間</label>
            {mergeRangeEnabled && <div><label className="reports-label" htmlFor="merge-range-start">區間開始快照（含）</label><select id="merge-range-start" value={effectiveRangeStart} disabled={!!pending} onChange={event => setRangeStartIndex(Number(event.target.value))}>{dataset.snapshots.slice(0, snapshotIndex + 1).map((item, index) => <option value={index} key={item.id} disabled={index < snapshotIndex - 99}>{item.label}</option>)}</select><p className="reports-caption">結束版為上方「選擇合併快照」，含開始與結束共 {snapshotIndex - effectiveRangeStart + 1} 次 merge。只影響後續生成報告；目前報告不會自動改寫。不包含未經 PR 的直接提交。</p></div>}
          </>}
          {!historical && <p className="reports-caption">此資料來源可回看各版狀態，尚未提供報告區間彙整。選擇一版不代表模型會同時收到所有歷史版本。</p>}
          </details>}
          <div className="reports-summary"><strong>{state.project_name}</strong><span>{state.repository.full_name}</span><span>資料截至 {state.updated_at}</span><span>快照 {state.event_id}</span></div>
          {historical && <div className="reports-snapshotEvidence"><a href={`https://github.com/${state.repository.full_name}/commit/${state.source_commit_sha}`} target="_blank" rel="noopener noreferrer">Commit {state.source_commit_sha.slice(0, 12)}</a><span>上一版：{state.base_state_id || '無（回放起點）'}</span><button className="reports-secondary" disabled={!!pending} onClick={() => saveBlob(new Blob([JSON.stringify(state, null, 2) + '\n'], { type: 'application/json;charset=utf-8' }), `${state.event_id}.json`)}>下載 Project State</button></div>}
          {repoOnly ? <p className="reports-detail">Repo Snapshot（不是正式 Project State）。功能進度、里程碑與風險尚未評估。<a href={`${state.repository.url}/commit/${state.source_commit_sha}`} target="_blank" rel="noopener noreferrer">查看固定 commit {state.source_commit_sha.slice(0, 12)}</a></p> : <div className="reports-metrics"><div><strong>{state.features.length}</strong><span>功能</span></div><div><strong>{state.risks.length}</strong><span>風險項目</span></div><div><strong>{state.data_gaps.length}</strong><span>資料缺口</span></div></div>}
          {!repoOnly && <details className="reports-details"><summary>功能、風險項目、資料缺口是甚麼？</summary><ul><li>功能：這版 State 記錄的功能或工程能力，包含已完成、進行中或尚無法確認的項目；不是已完成功能數。</li><li>風險項目：這版 State 已記錄的潛在風險或已發生問題；數量不代表專案的全部風險。</li><li>資料缺口：缺少證據或尚未評估的資訊類別，例如期限、功能規劃或風險評估；不是程式錯誤數。</li></ul><p className="reports-caption">數字只統計目前所選 State 的紀錄，不是本次報告的頁數或近期新增數。尚未評估不等於沒有風險。</p></details>}
          <p className="reports-label">{repoOnly ? '程式碼現況資料' : '最近一次合併'}</p><p className="reports-detail">{state.trigger.summary}</p>
          {historical && triggerSource && <p className="reports-caption"><a href={triggerSource.url} target="_blank" rel="noopener noreferrer">查看此次 PR：{triggerSource.title}</a></p>}
          <details className="reports-details"><summary>{repoOnly ? '查看 Repo Snapshot' : '查看完整 Project State'}</summary><pre>{JSON.stringify(state, null, 2)}</pre></details>
          <label className="reports-label" htmlFor="report-focus">報告生成需求（選填）</label>
          <textarea id="report-focus" rows={3} maxLength={4000} disabled={!!pending} value={focus} onChange={event => setFocus(event.target.value)} placeholder={defaultReportFocus} />
          <p className="reports-caption">{repoOnly ? '可修改預設需求；此來源只說明程式碼現況，缺少歷史比較時不能確認近期成果。' : '可修改預設需求，指定對象、語言或篇幅。留空仍會先介紹專案，再整理近期成果與待處理問題；缺少證據的部分會說明限制。'}</p>
          <label className="reports-confirm"><input type="checkbox" checked={!!dataset.supportsRepository && useRepository} disabled={!dataset.supportsRepository || !!pending} onChange={event => setUseRepository(event.target.checked)} />允許按需讀取此版本 repo</label>
          <p className="reports-caption">{dataset.supportsRepository ? `勾選後，生成報告可按需讀取這份狀態對應的 repo 版本（${state.source_commit_sha.slice(0, 12)}），不會自動跟隨 main 的後續變更。需要讀檔時會先由模型選檔；已驗證的結果可短期沿用。Repo 必須公開且可讀取。` : '此資料未提供可讀取的 GitHub repo 網址或完整版本資訊。'}</p>
          <button className="reports-primary" disabled={!!pending} onClick={() => run('generate')}>{pending === 'generate' ? '正在生成報告…' : report ? '重新生成報告' : '生成報告'}</button>
          {repositoryTrace && <details className="reports-details reports-repositoryTrace"><summary>本次 repo 讀取紀錄</summary><p className="reports-caption">Commit {repositoryTrace.commit.slice(0, 12)} · {repositoryTrace.status === 'not_needed' ? '模型判斷本次不需要讀取檔案' : `讀取 ${repositoryTrace.files.length} 段檔案內容`}{repositoryTrace.cached ? ' · 沿用快取，未重做選檔' : ''}</p><ul>{repositoryTrace.files.map((file, index) => <li key={index}><a href={file.url} target="_blank" rel="noopener noreferrer">{file.path}:{file.start_line}-{file.end_line}</a></li>)}</ul>{repositoryTrace.inventory && <><p className="reports-caption"><a href={repositoryTrace.inventory.url} target="_blank" rel="noopener noreferrer">此版本資料夾清單</a> · {repositoryTrace.inventory.directories.length} 個{repositoryTrace.inventory.complete ? '' : '（部分清單）'}。名稱只能證明資料夾存在，用途需另外依文件或程式碼確認。</p><ul>{repositoryTrace.inventory.directories.map(path => <li key={path}><code>{path}</code></li>)}</ul></>}<p className="reports-caption">紀錄僅代表最近一次成功的生成或修改，並非整份報告的所有來源。</p></details>}
        </section>
        <section className="reports-card reports-editorCard" aria-labelledby="report-title">
          <div className="reports-sectionHeader"><div><p className="reports-eyebrow">REPORT DRAFT</p><h2 id="report-title">報告草稿</h2></div><button className="reports-secondary" disabled={!report || !!pending} onClick={download}>下載 Markdown</button></div>
          {draftStorageEnabled && dataset.mockId && <><div className="reports-exportActions"><button type="button" className="reports-primary" disabled={!!pending || !report.trim() || !!proposal} onClick={() => persistDraft(false)}>{conversationEnabled ? '儲存草稿與對話' : '儲存草稿'}</button><button type="button" className="reports-secondary" disabled={!!pending} onClick={() => persistDraft(true)}>載入已存草稿</button></div><p className="reports-caption" role="status">{storageMessage || '尚未儲存或載入此快照的草稿。'} 復原紀錄只保留在目前頁面。</p></>}
          <MarkdownEditor value={report} onChange={manualEdit} disabled={!!pending} onModeChange={setSplitEditor} />
          <div className="reports-exportActions">
            <button type="button" className="reports-secondary" disabled={!!pending || !undoStack.length} onClick={() => restoreVersion('undo')}>復原上一版</button>
            <button type="button" className="reports-secondary" disabled={!!pending || !redoStack.length} onClick={() => restoreVersion('redo')}>恢復剛才的修改</button>
          </div>
          <p className="reports-caption">最多保留 20 個操作版本，僅存在此頁。請下載需要保留的報告。</p>
          {(automaticInspection.error || !!automaticInspection.quality?.warnings.length) && <div className="reports-quality" role="status" aria-label="報告自動檢查提醒"><p className="reports-caption">報告提醒（自動檢查，不代表事實已經驗證）</p>{automaticInspection.error ? <p>{automaticInspection.error}</p> : <ul>{automaticInspection.quality?.warnings.map((warning, index) => <li key={index}>第 {warning.page} 頁：{warning.message}</li>)}</ul>}</div>}
          <p className="reports-caption">產生簡報會使用這裡的最新內容。請下載 Markdown 保留手動編輯的報告。</p>
        </section>
        {conversationEnabled && <section className="reports-card" aria-labelledby="chat-title">
          <p className="reports-eyebrow">REFINE TOGETHER</p><h2 id="chat-title">對話修改</h2><p className="reports-detail">描述想調整的段落、語氣或長度。</p>
          <div className="reports-chatLog" aria-label="對話紀錄">{history.length ? history.map((turn, index) => <div className={turn.role === 'user' ? 'reports-userTurn' : 'reports-assistantTurn'} key={index}><strong>{turn.role === 'user' ? '你' : 'Report Agent'}</strong><p>{turn.content}</p></div>) : <p className="reports-empty">例如：將 Project Overview 的講稿縮短，保留目標日期。</p>}</div>
          <label className="reports-confirm"><input type="checkbox" checked={reviewChanges} disabled={!!pending} onChange={event => setReviewChanges(event.target.checked)} />修改前先確認差異</label>
          <form onSubmit={event => { event.preventDefault(); run('revise'); }}><label className="reports-label" htmlFor="revision-request">修改要求</label><textarea id="revision-request" rows={4} maxLength={4000} value={request} disabled={!!pending || !report.trim()} onChange={event => setRequest(event.target.value)} placeholder="想怎麼調整這份報告？" /><button className="reports-primary" disabled={!!pending || !!proposal || !report.trim() || !request.trim()}>{pending === 'revise' ? '正在修改報告…' : reviewChanges ? '預覽修改' : '套用修改'}</button></form>
          {proposal && <RevisionReview before={proposal.base} after={proposal.report} message={proposal.message} warnings={proposal.quality?.warnings} onAccept={acceptProposal} onReject={() => { setProposal(null); setNotice('已捨棄修改建議，原稿與修改要求已保留。'); }} />}
        </section>}
      </div>
      <section className="reports-card reports-slidesSection" aria-labelledby="slides-title">
        <div className="reports-sectionHeader"><div><p className="reports-eyebrow">PRESENTATION</p><h2 id="slides-title">產生簡報</h2></div><p className="reports-detail">確認報告後，開啟網頁簡報、下載 PPTX 或可攜式資料夾。</p></div>
        <div className="reports-exportControls">
          <div><label className="reports-label" htmlFor="presentation-kind">簡報形式</label><select id="presentation-kind" value={presentationKind} disabled={!!pending} onChange={event => setPresentationKind(event.target.value)}><option value="web">Slidev 網頁簡報：保留轉場與互動</option><option value="pptx">PowerPoint 檔案</option><option value="portable">可攜式網頁資料夾（ZIP）</option></select></div>
          <div><label className="reports-label" htmlFor="slide-transition">網頁播放轉場</label><select id="slide-transition" value={transition} disabled={!!pending} onChange={event => setTransition(event.target.value)}><option value="auto">LLM 自動安排轉場與特效</option><option value="">預設（不呼叫 LLM）</option><option value="fade">Fade</option><option value="fade-out">Fade out</option><option value="slide-left">Slide left</option><option value="slide-right">Slide right</option><option value="slide-up">Slide up</option><option value="slide-down">Slide down</option></select></div>
          {presentationKind === 'pptx' && <div><label className="reports-label" htmlFor="pptx-format">PPTX 格式</label><select id="pptx-format" value={format} disabled={!!pending} onChange={event => setFormat(event.target.value)}><option value="pptx">圖片式：保留畫面外觀</option><option value="pptx-editable">可編輯式：可調整文字與物件</option></select></div>}
        </div>
        <p className="reports-caption">自動模式會在產生 slides.md 時呼叫模型，依內容安排每頁轉場、重點逐項顯示與基本版面；報告文字、講稿與來源保持原樣。播放與下載沿用同一份設定，不會再次呼叫模型。</p>
        <label className="reports-confirm"><input type="checkbox" checked={!!report && confirmedReport === report} disabled={!report.trim() || !!pending} onChange={event => setConfirmedReport(event.target.checked ? report : '')} />我已確認目前報告內容</label>
        <div className="reports-exportActions"><button className="reports-primary" disabled={!!pending || !report.trim() || confirmedReport !== report} onClick={generateSlides}>{pending === 'slides' ? '正在產生原稿…' : '產生 Slidev 原稿'}</button><button className="reports-secondary" disabled={!!pending || !slidesCurrent} onClick={() => slideBundle && saveBlob(new Blob([slideBundle.markdown], { type: 'text/markdown;charset=utf-8' }), `${state.project_id}-slides.md`)}>下載 slides.md</button>{presentationKind === 'web' ? <button className="reports-primary" disabled={!!pending || !slidesCurrent} onClick={createWebDeck}>{pending === 'web' ? '正在建置網頁簡報…' : '建立網頁簡報'}</button> : presentationKind === 'portable' ? <button className="reports-primary" disabled={!!pending || !slidesCurrent} onClick={downloadPortable}>{pending === 'layout' ? '\u6b63\u5728\u4ee5 Chromium \u9010\u9801\u6aa2\u67e5\u7248\u9762\uff0c\u8acb\u7a0d\u5019\u3002' : pending === 'portable' ? '正在打包簡報…' : '下載可攜式資料夾'}</button> : <button className="reports-primary" disabled={!!pending || !slidesCurrent} onClick={downloadPptx}>{pending === 'export' ? '正在匯出 PPTX…' : '下載 PPTX'}</button>}</div>
        <button type="button" className="reports-secondary" disabled={!!pending || !slidesCurrent} onClick={inspectSlideLayout}>檢查投影片溢出</button>
        {layoutResult && slidesCurrent && layoutResult.markdown === slideBundle?.markdown && <p className={layoutResult.overflowPages.length ? 'reports-stale' : 'reports-caption'}>已檢查 {layoutResult.checkedPages} 頁。{layoutResult.overflowPages.length ? `可能溢出的頁面：${layoutResult.overflowPages.map(page => page.page).join('、')}。請縮短可見文字、調整版面或拆頁後重試。` : '未偵測到 DOM 溢出，仍需人工檢查換行、字型與 PPTX 輸出。'}</p>}
        {presentationKind === 'web' ? <p className="reports-caption">網頁簡報在新分頁播放，保留所選轉場。此播放連結僅供目前的本機網站使用，有效約兩小時；需要 Next.js 服務持續運行。</p> : presentationKind === 'portable' ? <p className="reports-caption">下載 ZIP 並解壓縮，Windows 執行 start.cmd；其他系統執行 node serve.mjs，再開啟顯示的網址。播放電腦需安裝 Node.js 22.12 以上，不需要原網站或 API Key。使用系統字型，文字與轉場可離線播放；來源連結仍需網路。目前不支援圖片打包。</p> : <p className="reports-caption">PPTX 不保留網頁轉場；可編輯版的字型與排版可能不同。匯出可能需要一至兩分鐘。</p>}
        {presentationKind === 'web' && webCurrent && webDeck && <div className="reports-webReady"><a href={webDeck.url} target="_blank" rel="noopener noreferrer">開啟播放</a><span>在播放頁使用方向鍵換頁。這是一份已確認報告的獨立快照。</span></div>}
        {presentationKind === 'web' && webCurrent && webDeck && <details className="reports-slidePreview"><summary>直接預覽網頁簡報</summary><iframe className="reports-slideFrame" src={webDeck.url} title="Slidev 簡報預覽" loading="lazy" /></details>}
        {slideBundle && !slidesCurrent && <p className="reports-stale" role="status">報告或轉場已變更，請重新產生原稿後再匯出。</p>}
        {slideBundle && <details className="reports-details reports-slidePreview"><summary>檢查 Slidev Markdown</summary><label className="reports-label" htmlFor="slides-markdown">編輯 slides.md</label><p className="reports-caption">可修改文字、講稿、分頁、layout、transition、clickAnimation 與 zoom。播放、PPTX、可攜式匯出與溢出檢查都使用這份原稿；不會修改上方報告。每頁請保留標題與末尾講稿註解。重新整理前請下載 slides.md。</p><textarea id="slides-markdown" rows={18} maxLength={200000} disabled={!!pending} value={slideBundle.markdown} onChange={event => { setSlideBundle({ ...slideBundle, markdown: event.target.value }); setWebDeck(null); setLayoutResult(null); }} spellCheck={false} /></details>}
      </section>
      <div className="reports-status" role="status">{pending === 'portable' ? '正在建置並打包可攜式簡報，請保留此頁面。' : pending === 'web' ? '正在建置 Slidev 網頁簡報，請保留此頁面。' : pending === 'export' ? '正在渲染並匯出 PPTX，請保留此頁面。' : pending === 'slides' ? '正在轉換簡報原稿。' : pending ? !!dataset.supportsRepository && useRepository ? '正在判斷所需檔案並生成報告；請保留此頁面。' : '正在等待模型回覆；服務暫時忙碌時會有限次重試，請保留此頁面。' : notice}</div>
      {error && <div className="reports-error" role="alert">{error}</div>}
      {pending && <div className="reports-exportActions"><span>已等待 {elapsed} 秒</span><button type="button" className="reports-secondary" onClick={() => activeOperation.current?.abort()}>取消目前操作</button></div>}
      {operationStats && <p className="reports-caption">最近操作：模型呼叫 {operationStats.modelCalls} 次 · HTTP 嘗試 {operationStats.httpAttempts} 次 · {(operationStats.durationMs / 1000).toFixed(1)} 秒 · 供應商回報 token：輸入 {operationStats.inputTokens}／輸出 {operationStats.outputTokens}（未回報時為 0）。</p>}
    </main>
  );
}
