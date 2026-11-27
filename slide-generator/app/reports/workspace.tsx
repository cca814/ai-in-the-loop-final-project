'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FormEvent } from 'react';
import { parseRecentProjects, readRecentProjects, rememberProject, subscribeRecentProjects } from './recent-projects';
import { WorkspaceActionError } from './workspace-types';
import type { ExportKind, WorkspaceActions, WorkspaceErrorCode, WorkspaceState } from './workspace-types';
import './workspace.css';

const defaultBrief = 'Introduce the project and its overall architecture, then summarize recent progress and outstanding issues.';
const errorMessages: Record<WorkspaceErrorCode, string> = {
  empty_states: 'This project has no Project States yet.',
  project_mismatch: 'The returned States do not match the requested project.',
  empty_report: 'No report was returned. Your current draft has been kept.',
  empty_slides: 'No slide source was returned. Your current source has been kept.',
  unavailable: 'The service is unavailable. Please try again later.',
  rate_limited: 'The service is busy. Please wait before trying again.',
};
type ReportSource = { key: string; label: string };
type Draft = { markdown: string; source: ReportSource | null };
type Slides = { markdown: string; report: string; sourceKey: string | null; automaticEffects: boolean };

function download(markdown: string, filename: string) {
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ReportWorkspace({ actions = {} }: { actions?: WorkspaceActions }) {
  const [projectId, setProjectId] = useState('');
  const recent = parseRecentProjects(useSyncExternalStore(subscribeRecentProjects, readRecentProjects, () => '[]'));
  const [states, setStates] = useState<WorkspaceState[]>([]);
  const [end, setEnd] = useState(0);
  const [start, setStart] = useState(0);
  const [includeRange, setIncludeRange] = useState(false);
  const [brief, setBrief] = useState(defaultBrief);
  const [draft, setDraft] = useState<Draft>({ markdown: '', source: null });
  const [undo, setUndo] = useState<Draft[]>([]);
  const [redo, setRedo] = useState<Draft[]>([]);
  const manualCheckpoint = useRef(false);
  const [slides, setSlides] = useState<Slides | null>(null);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [automaticEffects, setAutomaticEffects] = useState(true);
  const [kind, setKind] = useState<ExportKind>('web');
  const [pending, setPending] = useState('');
  const busy = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const report = draft.markdown;
  const selected = states[end];
  const selectedStates = states.slice(includeRange ? start : end, end + 1);
  const selectionKey = JSON.stringify(selectedStates.map(state => [state.project_id, state.event_id, state.source_commit_sha]));
  const sourceMismatch = !!draft.source && draft.source.key !== selectionKey;
  const slidesCurrent = !!slides && slides.report === report
    && slides.sourceKey === (draft.source?.key ?? null)
    && slides.automaticEffects === automaticEffects;
  const canGenerateReport = !!actions.generateReport && !!selected;
  const canGenerateSlides = !!actions.generateSlides && !!report.trim() && !sourceMismatch;
  const canExport = !!actions.exportSlides && slidesCurrent && !sourceMismatch && confirmed === report;

  useEffect(() => {
    if (!report && !slides) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [report, slides]);

  async function run(label: string, operation: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setPending(label);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof WorkspaceActionError
        ? errorMessages[cause.code]
        : 'The operation could not be completed. Your current content has been kept.');
    } finally {
      busy.current = false;
      setPending('');
    }
  }

  function handleLoad(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const load = actions.loadStates;
    if (!load || busy.current) return;
    if ((report || slides) && !window.confirm('Loading a project will clear the current report and slides. Continue?')) return;
    const id = projectId.trim();
    void run('Load project states', async () => {
      const result = await load(id);
      if (!result.length) throw new WorkspaceActionError('empty_states');
      if (result.some(state => state.project_id !== id)) throw new WorkspaceActionError('project_mismatch');
      const ordered = [...result].sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at) || a.event_id.localeCompare(b.event_id));
      setStates(ordered);
      setEnd(ordered.length - 1);
      setStart(0);
      setIncludeRange(false);
      setDraft({ markdown: '', source: null });
      setUndo([]);
      setRedo([]);
      setSlides(null);
      setConfirmed(null);
      manualCheckpoint.current = false;
      rememberProject(id);
      setNotice(`Loaded ${ordered.length} State versions.`);
    });
  }

  function handleGenerateReport() {
    const generate = actions.generateReport;
    if (!generate || !selected || busy.current) return;
    if (report && !window.confirm('Regenerating will replace the current report. Continue?')) return;
    const first = selectedStates[0];
    const source = {
      key: selectionKey,
      label: selectedStates.length === 1
        ? `${selected.project_name}: PR #${selected.pull_request.number} (${selected.source_commit_sha.slice(0, 12)})`
        : `${selected.project_name}: ${selectedStates.length} States, PR #${first.pull_request.number} through #${selected.pull_request.number}`,
    };
    void run('Generate report', async () => {
      const result = await generate({ states: selectedStates, brief });
      if (!result.trim()) throw new WorkspaceActionError('empty_report');
      setUndo(previous => [...previous, draft].slice(-20));
      setRedo([]);
      setDraft({ markdown: result, source });
      setConfirmed(null);
      manualCheckpoint.current = false;
      setNotice('Report generated. Please review its content.');
    });
  }

  function editReport(value: string) {
    if (value === report) return;
    if (!manualCheckpoint.current) {
      setUndo(previous => [...previous, draft].slice(-20));
      manualCheckpoint.current = true;
    }
    setRedo([]);
    setDraft({ ...draft, markdown: value });
    setConfirmed(null);
  }

  function restore(direction: 'undo' | 'redo') {
    const source = direction === 'undo' ? undo : redo;
    if (!source.length) return;
    if (direction === 'undo') {
      setUndo(source.slice(0, -1));
      setRedo(previous => [...previous, draft].slice(-20));
    } else {
      setRedo(source.slice(0, -1));
      setUndo(previous => [...previous, draft].slice(-20));
    }
    setDraft(source[source.length - 1]);
    setConfirmed(null);
    manualCheckpoint.current = false;
  }

  function handleGenerateSlides() {
    const generate = actions.generateSlides;
    if (!generate || !canGenerateSlides || confirmed !== report || busy.current) return;
    if (slides && !window.confirm('Regenerating will replace the current slides.md. Continue?')) return;
    void run('Generate Slidev source', async () => {
      const result = await generate({ report, automaticEffects });
      if (!result.trim()) throw new WorkspaceActionError('empty_slides');
      setSlides({ markdown: result, report, sourceKey: draft.source?.key ?? null, automaticEffects });
      setNotice('Slidev source generated.');
    });
  }

  function handleExport() {
    const exportSlides = actions.exportSlides;
    if (!exportSlides || !canExport || !slides || busy.current) return;
    void run('Export presentation', async () => {
      await exportSlides({ markdown: slides.markdown, kind });
      setNotice('Presentation operation completed.');
    });
  }

  return (
    <main className="reports-workspace">
      <header className="reports-header">
        <div>
          <p className="reports-brand">BRIDGING CODE AND INTENT</p>
          <h1>Project Progress Report</h1>
          <p className="reports-subtitle">Review project information, edit your report and create a presentation.</p>
        </div>
      </header>
      <p className="reports-banner">Changes stay in this page. Download your Markdown before refreshing.</p>
      <div className="reports-grid">
        <section className="reports-card" aria-labelledby="source-title">
          <p className="reports-eyebrow">PROJECT STATE</p>
          <h2 id="source-title">Report source</h2>
          <form onSubmit={handleLoad}>
            {!!recent.length && <>
              <label className="reports-label" htmlFor="recent-project-id">Recent project IDs</label>
              <select id="recent-project-id" value={recent.includes(projectId) ? projectId : ''}
                disabled={!!pending || !actions.loadStates} onChange={event => setProjectId(event.target.value)}>
                <option value="">Select a project</option>
                {recent.map(id => <option key={id}>{id}</option>)}
              </select>
            </>}
            <label className="reports-label" htmlFor="project-id">Project ID</label>
            <input id="project-id" required pattern={"[a-z0-9][a-z0-9\\-]{1,62}"} maxLength={63}
              value={projectId} disabled={!!pending || !actions.loadStates} onChange={event => setProjectId(event.target.value)} />
            <button className="reports-primary" disabled={!!pending || !actions.loadStates || !projectId.trim()}>Load project states</button>
            {!actions.loadStates && <p className="reports-caption">The project data source is not connected yet.</p>}
          </form>
          {selected && <>
            <label className="reports-label reports-snapshotLabel" htmlFor="state-version">Version (range end)</label>
            <select id="state-version" value={end} disabled={!!pending} onChange={event => {
              const index = Number(event.target.value);
              setEnd(index);
              setStart(previous => Math.min(previous, index));
              setConfirmed(null);
            }}>
              {states.map((state, index) => <option key={state.event_id} value={index}>PR #{state.pull_request.number} · {state.updated_at}</option>)}
            </select>
            <label className="reports-confirm">
              <input type="checkbox" checked={includeRange} disabled={!!pending || !actions.generateReport}
                onChange={event => { setIncludeRange(event.target.checked); setConfirmed(null); }} />
              Include a range of versions
            </label>
            {includeRange && <>
              <label className="reports-label" htmlFor="range-start">Range start (inclusive)</label>
              <select id="range-start" value={start} disabled={!!pending || !actions.generateReport}
                onChange={event => { setStart(Number(event.target.value)); setConfirmed(null); }}>
                {states.slice(0, end + 1).map((state, index) => <option key={state.event_id} value={index}>PR #{state.pull_request.number} · {state.updated_at}</option>)}
              </select>
            </>}
            <div className="reports-summary">
              <strong>{selected.project_name}</strong>
              <span>{selected.repository.full_name}</span>
              <span>Data collected: {selected.updated_at}</span>
              <span>Commit {selected.source_commit_sha.slice(0, 12)}</span>
            </div>
            <details className="reports-details"><summary>View Project State</summary><pre>{selected.content}</pre></details>
          </>}
          <label className="reports-label reports-snapshotLabel" htmlFor="report-brief">Report brief</label>
          <textarea id="report-brief" rows={4} maxLength={4000} value={brief} disabled={!!pending || !canGenerateReport}
            onChange={event => setBrief(event.target.value)} />
          <button className="reports-primary" disabled={!!pending || !canGenerateReport} onClick={handleGenerateReport}>
            {report ? 'Regenerate report' : 'Generate report'}
          </button>
          {!actions.generateReport && <p className="reports-caption">Report generation is not connected yet. You can edit a report directly.</p>}
        </section>
        <section className="reports-card reports-editorCard" aria-labelledby="report-title">
          <div className="reports-sectionHeader">
            <div><p className="reports-eyebrow">REPORT DRAFT</p><h2 id="report-title">Report draft</h2></div>
            <button className="reports-secondary" disabled={!report.trim()} onClick={() => download(report, 'report.md')}>Download Markdown</button>
          </div>
          {draft.source && <p className="reports-caption">Report generated from {draft.source.label}.</p>}
          {sourceMismatch && <p className="reports-stale" role="status">
            This report was generated from a different State selection. Your edits are kept. Restore that selection or regenerate before creating a presentation.
          </p>}
          <label className="reports-label" htmlFor="report-markdown">Edit Markdown</label>
          <textarea id="report-markdown" className="reports-editor" value={report} disabled={!!pending}
            onChange={event => editReport(event.target.value)} onBlur={() => { manualCheckpoint.current = false; }}
            placeholder="Generate a report or paste Markdown here to edit it." spellCheck={false} />
          <div className="reports-exportActions">
            <button className="reports-secondary" disabled={!!pending || !undo.length} onClick={() => restore('undo')}>Undo</button>
            <button className="reports-secondary" disabled={!!pending || !redo.length} onClick={() => restore('redo')}>Redo</button>
          </div>
        </section>
      </div>
      <section className="reports-card reports-slidesSection" aria-labelledby="slides-title">
        <p className="reports-eyebrow">PRESENTATION</p>
        <h2 id="slides-title">Create presentation</h2>
        <label className="reports-confirm">
          <input type="checkbox" checked={!!report && confirmed === report} disabled={!!pending || !canGenerateSlides}
            onChange={event => setConfirmed(event.target.checked ? report : null)} />
          I have reviewed the current report
        </label>
        <label className="reports-confirm">
          <input type="checkbox" checked={automaticEffects} disabled={!!pending || !actions.generateSlides}
            onChange={event => setAutomaticEffects(event.target.checked)} />
          Let the model choose transitions and effects
        </label>
        <button className="reports-primary" disabled={!!pending || !canGenerateSlides || confirmed !== report} onClick={handleGenerateSlides}>
          Generate Slidev source
        </button>
        <label className="reports-label reports-snapshotLabel" htmlFor="slides-markdown">Slidev source (read-only)</label>
        <textarea id="slides-markdown" rows={12} value={slides?.markdown ?? ''} readOnly spellCheck={false} />
        {slides && !slidesCurrent && <p className="reports-stale">The report or effects setting has changed. Regenerate the slide source before exporting.</p>}
        <div className="reports-exportActions">
          <button className="reports-secondary" disabled={!slides?.markdown.trim()}
            onClick={() => slides && download(slides.markdown, 'slides.md')}>Download slides.md</button>
          <label htmlFor="presentation-kind">Presentation format</label>
          <select id="presentation-kind" value={kind} disabled={!!pending || !actions.exportSlides}
            onChange={event => setKind(event.target.value as ExportKind)}>
            <option value="web">Slidev web presentation</option>
            <option value="pptx">PowerPoint file</option>
            <option value="portable">Portable folder (ZIP)</option>
          </select>
          <button className="reports-primary" disabled={!!pending || !canExport} onClick={handleExport}>
            {kind === 'web' ? 'Open web presentation' : kind === 'pptx' ? 'Download PPTX' : 'Download portable folder'}
          </button>
        </div>
        {!actions.generateSlides && <p className="reports-caption">Slide generation is not connected yet. Generated source will appear here as read-only.</p>}
        {!actions.exportSlides && <p className="reports-caption">Presentation exports are not connected yet.</p>}
      </section>
      <p className="reports-status" role="status">{pending ? `${pending} — please wait.` : notice}</p>
      {error && <p className="reports-error" role="alert">{error}</p>}
    </main>
  );
}
