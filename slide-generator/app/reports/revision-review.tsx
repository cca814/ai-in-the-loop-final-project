'use client';

import { useLayoutEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function RevisionReview({ before, after, message, warnings = [], onAccept, onReject }: {
  before: string; after: string; message: string; warnings?: { page: number; message: string }[]; onAccept: () => void; onReject: () => void;
}) {
  const beforeRef = useRef<HTMLDivElement>(null);
  const afterRef = useRef<HTMLDivElement>(null);
  const expectedScroll = useRef(new WeakMap<HTMLElement, number>());
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
  return <section className="reports-review" aria-label="修改差異確認">
    <h3>確認修改後再套用</h3><p>{message}</p>
    <p className="reports-caption">原稿尚未變更。左右為完整報告的修改前後預覽，依捲動比例同步；模型說明不代表事實已驗證。</p>
    {!!warnings.length && <details className="reports-quality"><summary>候選報告有 {warnings.length} 項待核對</summary><ul>{warnings.map((warning, index) => <li key={index}>第 {warning.page} 頁：{warning.message}</li>)}</ul></details>}
    <div className="reports-reviewColumns">
      <div><h4 id="revision-before-label">修改前</h4><div ref={beforeRef} className="reports-markdownPreview reports-reviewPreview" role="region" aria-labelledby="revision-before-label" tabIndex={0} onScroll={event => syncScroll(event.currentTarget, afterRef.current)}>{preview(before)}</div></div>
      <div><h4 id="revision-after-label">修改後</h4><div ref={afterRef} className="reports-markdownPreview reports-reviewPreview" role="region" aria-labelledby="revision-after-label" tabIndex={0} onScroll={event => syncScroll(event.currentTarget, beforeRef.current)}>{preview(after)}</div></div>
    </div>
    <div className="reports-exportActions"><button type="button" className="reports-primary" onClick={onAccept}>接受這次修改</button><button type="button" className="reports-secondary" onClick={onReject}>捨棄這次修改</button></div>
  </section>;
}
