'use client';

import { useState } from 'react';
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
          <textarea id="report-markdown" className="reports-editor" value={value} disabled={disabled} onChange={event => onChange(event.target.value)} placeholder="生成報告後，內容會顯示在這裡。你也可以直接貼上並編輯報告。" spellCheck={false} />
        </div>}
        {mode !== 'edit' && <div className="reports-markdownPane">
          <p className="reports-label" id="report-preview-label">報告預覽</p>
          <div className="reports-markdownPreview" role="region" aria-labelledby="report-preview-label" tabIndex={0}>
            {value.trim() ? <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
              a: ({ children, href, title }) => <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>,
            }}>{value}</Markdown> : <p className="reports-previewEmpty">生成或輸入 Markdown 後，排版結果會顯示在這裡。</p>}
          </div>
        </div>}
      </div>
    </>
  );
}
