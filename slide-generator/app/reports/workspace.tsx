'use client';

import { useState } from 'react';
import MarkdownEditor from './markdown-editor';
import { stateDatasets } from './state-datasets';
import './workspace.css';

type Turn = { role: 'user' | 'assistant'; content: string };
type PresentationPlan = { pages: { transition: string; layout: string; reveal: boolean; clickAnimation: string }[] };
type SlideBundle = { markdown: string; report: string; transition: string; presentationPlan?: PresentationPlan };
type WebDeck = { url: string; expiresAt: string; report: string; transition: string };
type RepositoryTrace = { commit: string; status: 'read' | 'not_needed'; files: { path: string; start_line: number; end_line: number; url: string }[] };

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ReportWorkspace() {
  const [datasetId, setDatasetId] = useState('demo');
  const [snapshotId, setSnapshotId] = useState('normal');
  const [report, setReport] = useState('');
  const [splitEditor, setSplitEditor] = useState(false);
  const [history, setHistory] = useState<Turn[]>([]);
  const [request, setRequest] = useState('');
  const [focus, setFocus] = useState('');
  const [useRepository, setUseRepository] = useState(false);
  const [mergeRangeEnabled, setMergeRangeEnabled] = useState(false);
  const [rangeStartIndex, setRangeStartIndex] = useState(0);
  const [repositoryTrace, setRepositoryTrace] = useState<RepositoryTrace | null>(null);
  const [pending, setPending] = useState<'generate' | 'revise' | 'slides' | 'export' | 'web' | 'portable' | null>(null);
  const [presentationKind, setPresentationKind] = useState('web');
  const [webDeck, setWebDeck] = useState<WebDeck | null>(null);
  const [transition, setTransition] = useState('auto');
  const [format, setFormat] = useState('pptx');
  const [confirmedReport, setConfirmedReport] = useState('');
  const [slideBundle, setSlideBundle] = useState<SlideBundle | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('選擇資料後，生成第一份報告。');
  const dataset = stateDatasets.find(item => item.id === datasetId)!;
  const snapshotIndex = dataset.snapshots.findIndex(item => item.id === snapshotId);
  const state = dataset.snapshots[snapshotIndex].state;
  const historical = datasetId === 'p-limit';
  const effectiveRangeStart = Math.min(rangeStartIndex, snapshotIndex);
  const mergeRange = historical && mergeRangeEnabled ? { startCommit: dataset.snapshots[effectiveRangeStart].state.source_commit_sha, endCommit: state.source_commit_sha } : undefined;
  const triggerSource = state.source_refs.find(ref => ref.id === state.trigger.source_ref_id);
  const slidesCurrent = !!slideBundle && slideBundle.report === report && slideBundle.transition === transition;
  const webCurrent = !!webDeck && webDeck.report === report && webDeck.transition === transition;

  function changeSnapshot(nextDataset: string, value: string) {
    if (nextDataset === datasetId && value === snapshotId) return;
    if (report && !window.confirm('切換資料會清除目前報告與對話。請先下載需要保留的內容。是否繼續？')) return;
    setDatasetId(nextDataset);
    if (nextDataset !== datasetId) { setUseRepository(false); setFocus(''); setMergeRangeEnabled(false); setRangeStartIndex(0); }
    else setRangeStartIndex(previous => Math.min(previous, dataset.snapshots.findIndex(item => item.id === value)));
    setSnapshotId(value);
    setReport('');
    setHistory([]);
    setRequest('');
    setError('');
    setSlideBundle(null);
    setWebDeck(null);
    setConfirmedReport('');
    setRepositoryTrace(null);
    setNotice('已切換資料，可以生成新報告。');
  }

  async function run(mode: 'generate' | 'revise') {
    if (pending) return;
    if (mode === 'generate' && report && !window.confirm('重新生成會取代目前報告並清除對話，是否繼續？')) return;
    setPending(mode);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/reports/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'generate' ? { state, focus, mergeRange, useRepository: historical && useRepository } : { state, report, request, history, mergeRange, useRepository: historical && useRepository }),
      });
      const result = await response.json();
      if (!response.ok) {
        const stages: Record<string, string> = { repository_selection: 'Repo 選檔階段：', report_generation: '報告生成階段：', report_revision: '報告修改階段：' };
        throw new Error(`${stages[result.stage] || ''}${result.error || '請求失敗，請稍後重試。'}${result.code ? ` [${result.code}]` : ''}`);
      }
      if (typeof result.report !== 'string' || !result.report.trim()) throw new Error('伺服器回傳的報告為空或格式不正確。');
      setReport(result.report);
      setRepositoryTrace(result.repository || null);
      if (mode === 'generate') {
        setHistory([]);
        setNotice('報告已生成。你可以直接編輯，或在右側提出修改要求。');
      } else {
        const changed = result.report !== report;
        setHistory(previous => [...previous, { role: 'user', content: request }, { role: 'assistant', content: result.message || (changed ? '報告已更新。' : '模型未對報告提出修改。') }]);
        setRequest('');
        setNotice(changed ? '修改已套用至目前報告。' : '本次未修改報告，請查看對話回覆。');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '請求失敗，請稍後重試。');
      setNotice(report.trim() ? '本次請求未完成，目前報告與對話已保留。' : '本次尚未產生報告，請稍後重試。');
    } finally {
      setPending(null);
    }
  }

  function download() {
    saveBlob(new Blob([report], { type: 'text/markdown;charset=utf-8' }), `${state.project_id}-${state.event_id}-report.md`);
    setNotice('已下載目前的 Markdown 報告。');
  }

  async function generateSlides() {
    if (pending || !report.trim() || confirmedReport !== report) return;
    setPending('slides');
    setError('');
    try {
      const response = await fetch('/api/reports/slides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report, transition }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '無法產生 Slidev 原稿。');
      if (typeof result.slides !== 'string') throw new Error('簡報原稿格式不正確。');
      if (transition === 'auto' && (!result.presentationPlan || !Array.isArray(result.presentationPlan.pages))) throw new Error('模型未回傳有效的簡報特效設定。');
      setSlideBundle({ markdown: result.slides, report, transition, presentationPlan: result.presentationPlan });
      setWebDeck(null);
      setNotice('Slidev 原稿已產生，可以建立網頁簡報或下載。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '無法產生簡報。');
    } finally { setPending(null); }
  }

  async function downloadPptx() {
    if (pending || !slidesCurrent || !slideBundle) return;
    setPending('export');
    setError('');
    try {
      const response = await fetch('/api/reports/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report: slideBundle.report, transition: slideBundle.transition, presentationPlan: slideBundle.presentationPlan, format }) });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || 'PPTX 匯出失敗。');
      }
      saveBlob(await response.blob(), `${state.project_id}-${state.event_id}-${format}.pptx`);
      setNotice('PPTX 已下載。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'PPTX 匯出失敗。');
    } finally { setPending(null); }
  }

  async function createWebDeck() {
    if (pending || !slidesCurrent || !slideBundle) return;
    setPending('web');
    setError('');
    try {
      const response = await fetch('/api/reports/web', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report: slideBundle.report, transition: slideBundle.transition, presentationPlan: slideBundle.presentationPlan }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '無法建立網頁簡報。');
      if (typeof result.url !== 'string' || !result.url.startsWith('/api/reports/present/') || typeof result.expiresAt !== 'string') throw new Error('網頁簡報連結格式不正確。');
      setWebDeck({ url: result.url, expiresAt: result.expiresAt, report: slideBundle.report, transition: slideBundle.transition });
      setNotice('網頁簡報已就緒，請按「開啟播放」在新分頁播放。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '無法建立網頁簡報。');
    } finally { setPending(null); }
  }

  async function downloadPortable() {
    if (pending || !slidesCurrent || !slideBundle) return;
    setPending('portable');
    setError('');
    try {
      const response = await fetch('/api/reports/portable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ report: slideBundle.report, transition: slideBundle.transition, presentationPlan: slideBundle.presentationPlan }) });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || '可攜式簡報匯出失敗。');
      }
      saveBlob(await response.blob(), `${state.project_id}-${state.event_id}-portable.zip`);
      setNotice('可攜式簡報已下載。請解壓縮後執行 start.cmd，並開啟顯示的網址。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '可攜式簡報匯出失敗。');
    } finally { setPending(null); }
  }

  return (
    <main className="reports-workspace">
      <header className="reports-header">
        <div><p className="reports-brand">BRIDGING CODE AND INTENT</p><h1>專案進度報告</h1><p className="reports-subtitle">從專案現況整理報告，讓每一次修改都有依據。</p></div>
        <span className="reports-badge">本機測試 · {historical ? 'p-limit 歷史回放' : '範例資料'}</span>
      </header>
      <div className="reports-banner">目前草稿與對話只保留在此頁面，重新整理後會清除。請下載需要保留的報告。</div>
      <div className={`reports-grid${splitEditor ? ' reports-gridSplit' : ''}`}>
        <section className="reports-card" aria-labelledby="state-title">
          <p className="reports-eyebrow">PROJECT STATE</p><h2 id="state-title">報告的資料來源</h2>
          <label className="reports-label" htmlFor="state-dataset">選擇專案資料</label>
          <select id="state-dataset" value={datasetId} disabled={!!pending} onChange={event => {
            const next = stateDatasets.find(item => item.id === event.target.value)!;
            changeSnapshot(next.id, next.snapshots[0].id);
          }}>{stateDatasets.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select>
          <label className="reports-label reports-snapshotLabel" htmlFor="state-example">{historical ? '選擇合併快照' : '選擇範例快照'}</label>
          <select id="state-example" value={snapshotId} disabled={!!pending} onChange={event => changeSnapshot(datasetId, event.target.value)}>
            {dataset.snapshots.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}
          </select>
          {historical && <>
            <div className="reports-snapshotNavigation"><button className="reports-secondary" disabled={!!pending || snapshotIndex === 0} onClick={() => changeSnapshot(datasetId, dataset.snapshots[snapshotIndex - 1].id)}>上一版</button><span>{snapshotIndex + 1} / {dataset.snapshots.length}</span><button className="reports-secondary" disabled={!!pending || snapshotIndex === dataset.snapshots.length - 1} onClick={() => changeSnapshot(datasetId, dataset.snapshots[snapshotIndex + 1].id)}>下一版</button></div>
            <p className="reports-caption">每版是一次 merge 後的完整狀態，依合併時間排序。這是歷史重建測試資料；時間代表當時的資料截止點，缺少的歷史評估已標為資料缺口。</p>
            <label className="reports-confirm"><input type="checkbox" checked={mergeRangeEnabled} disabled={!!pending} onChange={event => setMergeRangeEnabled(event.target.checked)} />彙整合併區間</label>
            {mergeRangeEnabled && <div><label className="reports-label" htmlFor="merge-range-start">區間開始快照（含）</label><select id="merge-range-start" value={effectiveRangeStart} disabled={!!pending} onChange={event => setRangeStartIndex(Number(event.target.value))}>{dataset.snapshots.slice(0, snapshotIndex + 1).map((item, index) => <option value={index} key={item.id}>{item.label}</option>)}</select><p className="reports-caption">結束版為上方「選擇合併快照」，含開始與結束共 {snapshotIndex - effectiveRangeStart + 1} 次 merge。只影響後續生成或對話修改；目前報告不會自動改寫。不包含未經 PR 的直接提交。</p></div>}
          </>}
          <div className="reports-summary"><strong>{state.project_name}</strong><span>{state.repository.full_name}</span><span>資料截至 {state.updated_at}</span><span>快照 {state.event_id}</span></div>
          {historical && <div className="reports-snapshotEvidence"><a href={`https://github.com/${state.repository.full_name}/commit/${state.source_commit_sha}`} target="_blank" rel="noopener noreferrer">Commit {state.source_commit_sha.slice(0, 12)}</a><span>上一版：{state.base_state_id || '無（回放起點）'}</span><button className="reports-secondary" disabled={!!pending} onClick={() => saveBlob(new Blob([JSON.stringify(state, null, 2) + '\n'], { type: 'application/json;charset=utf-8' }), `${state.event_id}.json`)}>下載 Project State</button></div>}
          <div className="reports-metrics"><div><strong>{state.features.length}</strong><span>功能</span></div><div><strong>{state.risks.length}</strong><span>風險項目</span></div><div><strong>{state.data_gaps.length}</strong><span>資料缺口</span></div></div>
          <p className="reports-label">最近一次合併</p><p className="reports-detail">{state.trigger.summary}</p>
          {historical && triggerSource && <p className="reports-caption"><a href={triggerSource.url} target="_blank" rel="noopener noreferrer">查看此次 PR：{triggerSource.title}</a></p>}
          <details className="reports-details"><summary>查看完整 Project State</summary><pre>{JSON.stringify(state, null, 2)}</pre></details>
          <label className="reports-label" htmlFor="report-focus">報告生成需求（選填）</label>
          <textarea id="report-focus" rows={3} maxLength={4000} disabled={!!pending} value={focus} onChange={event => setFocus(event.target.value)} placeholder="例如：向主管簡報近期成果與尚待處理的問題，分成兩節，避免程式碼細節。" />
          <p className="reports-caption">可指定對象、章節、語言與篇幅；留空則以工程師向主管匯報近期進度的方式撰寫。</p>
          <label className="reports-confirm"><input type="checkbox" checked={historical && useRepository} disabled={!historical || !!pending} onChange={event => setUseRepository(event.target.checked)} />允許按需讀取此版本 repo</label>
          <p className="reports-caption">{historical ? '每次生成或修改會增加一次選檔模型請求，再按需求讀取本次 commit 的歷史內容。只改語氣或翻譯時可不讀檔，但仍會執行選檔判斷。' : 'Repo 讀取目前僅支援 p-limit 歷史快照。'}</p>
          <button className="reports-primary" disabled={!!pending} onClick={() => run('generate')}>{pending === 'generate' ? '正在生成報告…' : report ? '重新生成報告' : '生成報告'}</button>
          {repositoryTrace && <details className="reports-details reports-repositoryTrace"><summary>本次 repo 讀取紀錄</summary><p className="reports-caption">Commit {repositoryTrace.commit.slice(0, 12)} · {repositoryTrace.status === 'not_needed' ? '模型判斷本次不需要讀取檔案' : `讀取 ${repositoryTrace.files.length} 段檔案內容`}</p><ul>{repositoryTrace.files.map((file, index) => <li key={index}><a href={file.url} target="_blank" rel="noopener noreferrer">{file.path}:{file.start_line}-{file.end_line}</a></li>)}</ul><p className="reports-caption">紀錄僅代表最近一次成功的生成或修改，並非整份報告的所有來源。</p></details>}
        </section>
        <section className="reports-card reports-editorCard" aria-labelledby="report-title">
          <div className="reports-sectionHeader"><div><p className="reports-eyebrow">REPORT DRAFT</p><h2 id="report-title">報告草稿</h2></div><button className="reports-secondary" disabled={!report || !!pending} onClick={download}>下載 Markdown</button></div>
          <MarkdownEditor value={report} onChange={setReport} disabled={!!pending} onModeChange={setSplitEditor} />
          <p className="reports-caption">每次對話修改都使用這裡的最新內容，包括你的手動編輯。</p>
        </section>
        <section className="reports-card" aria-labelledby="chat-title">
          <p className="reports-eyebrow">REFINE TOGETHER</p><h2 id="chat-title">對話修改</h2><p className="reports-detail">描述想調整的段落、語氣或長度。</p>
          <div className="reports-chatLog" aria-label="對話紀錄">{history.length ? history.map((turn, index) => <div className={turn.role === 'user' ? 'reports-userTurn' : 'reports-assistantTurn'} key={index}><strong>{turn.role === 'user' ? '你' : 'Report Agent'}</strong><p>{turn.content}</p></div>) : <p className="reports-empty">例如：將 Project Overview 的講稿縮短，保留目標日期。</p>}</div>
          <form onSubmit={event => { event.preventDefault(); run('revise'); }}><label className="reports-label" htmlFor="revision-request">修改要求</label><textarea id="revision-request" rows={4} maxLength={4000} value={request} disabled={!!pending || !report.trim()} onChange={event => setRequest(event.target.value)} placeholder="想怎麼調整這份報告？" /><button className="reports-primary" disabled={!!pending || !report.trim() || !request.trim()}>{pending === 'revise' ? '正在修改報告…' : '套用修改'}</button></form>
        </section>
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
        <div className="reports-exportActions"><button className="reports-primary" disabled={!!pending || !report.trim() || confirmedReport !== report} onClick={generateSlides}>{pending === 'slides' ? '正在產生原稿…' : '產生 Slidev 原稿'}</button><button className="reports-secondary" disabled={!!pending || !slidesCurrent} onClick={() => slideBundle && saveBlob(new Blob([slideBundle.markdown], { type: 'text/markdown;charset=utf-8' }), `${state.project_id}-slides.md`)}>下載 slides.md</button>{presentationKind === 'web' ? <button className="reports-primary" disabled={!!pending || !slidesCurrent} onClick={createWebDeck}>{pending === 'web' ? '正在建置網頁簡報…' : '建立網頁簡報'}</button> : presentationKind === 'portable' ? <button className="reports-primary" disabled={!!pending || !slidesCurrent} onClick={downloadPortable}>{pending === 'portable' ? '正在打包簡報…' : '下載可攜式資料夾'}</button> : <button className="reports-primary" disabled={!!pending || !slidesCurrent} onClick={downloadPptx}>{pending === 'export' ? '正在匯出 PPTX…' : '下載 PPTX'}</button>}</div>
        {presentationKind === 'web' ? <p className="reports-caption">網頁簡報在新分頁播放，保留所選轉場。此播放連結僅供目前的本機網站使用，有效約兩小時；需要 Next.js 服務持續運行。</p> : presentationKind === 'portable' ? <p className="reports-caption">下載 ZIP 並解壓縮，Windows 執行 start.cmd；其他系統執行 node serve.mjs，再開啟顯示的網址。播放電腦需安裝 Node.js 22.12 以上，不需要原網站或 API Key。使用系統字型，文字與轉場可離線播放；來源連結仍需網路。目前不支援圖片打包。</p> : <p className="reports-caption">PPTX 不保留網頁轉場；可編輯版的字型與排版可能不同。匯出可能需要一至兩分鐘。</p>}
        {presentationKind === 'web' && webCurrent && webDeck && <div className="reports-webReady"><a href={webDeck.url} target="_blank" rel="noopener noreferrer">開啟播放</a><span>在播放頁使用方向鍵換頁。這是一份已確認報告的獨立快照。</span></div>}
        {slideBundle && !slidesCurrent && <p className="reports-stale" role="status">報告或轉場已變更，請重新產生原稿後再匯出。</p>}
        {slideBundle && <details className="reports-details reports-slidePreview"><summary>檢查 Slidev Markdown</summary><label className="reports-label" htmlFor="slides-markdown">簡報原稿（唯讀）</label><textarea id="slides-markdown" rows={12} readOnly value={slideBundle.markdown} spellCheck={false} /></details>}
      </section>
      <div className="reports-status" role="status">{pending === 'portable' ? '正在建置並打包可攜式簡報，請保留此頁面。' : pending === 'web' ? '正在建置 Slidev 網頁簡報，請保留此頁面。' : pending === 'export' ? '正在渲染並匯出 PPTX，請保留此頁面。' : pending === 'slides' ? '正在轉換簡報原稿。' : pending ? historical && useRepository ? '正在判斷所需檔案並生成或修改報告；請保留此頁面。' : '正在等待模型回覆；服務暫時忙碌時會有限次重試，請保留此頁面。' : notice}</div>
      {error && <div className="reports-error" role="alert">{error}</div>}
    </main>
  );
}
