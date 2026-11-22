'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function RevisionReview({ before, after, message, warnings = [], onAccept, onReject }: {
  before: string; after: string; message: string; warnings?: { page: number; message: string }[]; onAccept: () => void; onReject: () => void;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const beforeRef = useRef<HTMLDivElement>(null);
  const afterRef = useRef<HTMLDivElement>(null);
  const expectedScroll = useRef(new WeakMap<HTMLElement, number>());
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen || !dialog) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    headingRef.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [isOpen]);
  useLayoutEffect(() => {
    expectedScroll.current = new WeakMap();
    if (beforeRef.current) beforeRef.current.scrollTop = 0;
    if (afterRef.current) afterRef.current.scrollTop = 0;
  }, [before, after]);

  function syncScroll(source: HTMLElement, target: HTMLElement | null) {
    const expected = expectedScroll.current.get(source);
    expectedScroll.current.delete(source);
    if (expected !== undefined && Math.abs(source.scrollTop - expected) < 1) return;
    const range = source.scrollHeight - source.clientHeight;
    if (range <= 0 || !target) return;
    const ratio = Math.max(0, Math.min(1, source.scrollTop / range));
    target.scrollTop = ratio * Math.max(0, target.scrollHeight - target.clientHeight);
    expectedScroll.current.set(target, target.scrollTop);
  }

  const preview = (content: string) => <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    a: ({ children, href, title }) => <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>,
  }}>{content}</Markdown>;
  return <>
    {!isOpen && <div className="reports-review"><p>修改建議尚未套用。</p><button type="button" className="reports-secondary" onClick={() => setIsOpen(true)}>開啟修改預覽</button></div>}
    <dialog ref={dialogRef} className="reports-review reports-reviewDialog" aria-labelledby="revision-review-title" aria-describedby="revision-review-help" onCancel={event => { event.preventDefault(); setIsOpen(false); }} onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"])')).filter(element => element.getClientRects().length > 0);
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <header className="reports-reviewHeader"><h2 id="revision-review-title" ref={headingRef} tabIndex={-1}>確認修改後再套用</h2><button type="button" className="reports-secondary" onClick={() => setIsOpen(false)}>稍後再確認</button></header>
    <div className="reports-reviewIntro"><p>{message}</p>
    <p id="revision-review-help" className="reports-caption">原稿尚未變更。左右為完整報告的修改前後預覽，依捲動比例同步；模型說明不代表事實已驗證。按 Esc 或「稍後再確認」會保留建議。</p>
    {!!warnings.length && <details className="reports-quality"><summary>候選報告有 {warnings.length} 項待核對</summary><ul>{warnings.map((warning, index) => <li key={index}>第 {warning.page} 頁：{warning.message}</li>)}</ul></details>}
    </div>
    <div className="reports-reviewColumns">
      <div><h4 id="revision-before-label">修改前</h4><div ref={beforeRef} className="reports-markdownPreview reports-reviewPreview" role="region" aria-labelledby="revision-before-label" tabIndex={0} onScroll={event => syncScroll(event.currentTarget, afterRef.current)}>{preview(before)}</div></div>
      <div><h4 id="revision-after-label">修改後</h4><div ref={afterRef} className="reports-markdownPreview reports-reviewPreview" role="region" aria-labelledby="revision-after-label" tabIndex={0} onScroll={event => syncScroll(event.currentTarget, beforeRef.current)}>{preview(after)}</div></div>
    </div>
    <footer className="reports-exportActions reports-reviewFooter"><button type="button" className="reports-primary" onClick={onAccept}>接受這次修改</button><button type="button" className="reports-secondary" onClick={onReject}>捨棄這次修改</button></footer>
  </dialog></>;
}
