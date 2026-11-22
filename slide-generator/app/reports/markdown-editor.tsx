'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Mode = 'edit' | 'preview' | 'split';

export default function MarkdownEditor({ value, onChange, disabled, onModeChange }: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  onModeChange: (split: boolean) => void;
}) {
  const [mode, setMode] = useState<Mode>('edit');
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const scrollRatio = useRef(0);
  const expectedScroll = useRef(new WeakMap<HTMLElement, number>());

  function setScroll(element: HTMLElement | null, ratio: number) {
    if (!element) return;
    element.scrollTop = ratio * Math.max(0, element.scrollHeight - element.clientHeight);
    // Scroll events are asynchronous; ignore the event caused by this update
    // so rounding differences cannot send the two panes into a feedback loop.
    expectedScroll.current.set(element, element.scrollTop);
  }

  function syncScroll(source: HTMLElement, target: HTMLElement | null) {
    const expected = expectedScroll.current.get(source);
    expectedScroll.current.delete(source);
    if (expected !== undefined && Math.abs(source.scrollTop - expected) < 1) return;
    const range = source.scrollHeight - source.clientHeight;
    // A short pane cannot represent the other pane's position. Leave its
    // counterpart alone rather than unexpectedly jumping back to the top.
    if (range <= 0) return;
    const ratio = Math.max(0, Math.min(1, source.scrollTop / range));
    scrollRatio.current = ratio;
    if (mode === 'split') setScroll(target, ratio);
  }

  useLayoutEffect(() => {
    setScroll(editorRef.current, scrollRatio.current);
    setScroll(previewRef.current, scrollRatio.current);
  }, [mode]);

  function changeMode(next: Mode) {
    setMode(next);
    onModeChange(next === 'split');
  }

  return (
    <>
      <div className="reports-editorModes" role="group" aria-label="Markdown 顯示模式">
        {([['edit', '編輯'], ['preview', '檢視'], ['split', '雙欄']] as const).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={mode === id} onClick={() => changeMode(id)}>{label}</button>
        ))}
      </div>
      <div className={`reports-markdownWorkspace reports-markdownWorkspace-${mode}`}>
        {mode !== 'preview' && <div className="reports-markdownPane">
          <label className="reports-label" htmlFor="report-markdown">直接編輯 Markdown</label>
          <textarea ref={editorRef} id="report-markdown" className="reports-editor" value={value} disabled={disabled} onChange={event => onChange(event.target.value)} onScroll={event => syncScroll(event.currentTarget, previewRef.current)} placeholder="生成報告後，內容會顯示在這裡。你也可以直接貼上並編輯報告。" spellCheck={false} />
        </div>}
        {mode !== 'edit' && <div className="reports-markdownPane">
          <p className="reports-label" id="report-preview-label">報告預覽</p>
          <div ref={previewRef} className="reports-markdownPreview" role="region" aria-labelledby="report-preview-label" tabIndex={0} onScroll={event => syncScroll(event.currentTarget, editorRef.current)}>
            {value.trim() ? <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
              a: ({ children, href, title }) => <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>,
            }}>{value}</Markdown> : <p className="reports-previewEmpty">生成或輸入 Markdown 後，排版結果會顯示在這裡。</p>}
          </div>
        </div>}
      </div>
    </>
  );
}
