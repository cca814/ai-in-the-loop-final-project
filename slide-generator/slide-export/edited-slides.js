import { transitions } from './presentation-plan.js';

export class SlideSourceError extends Error {}
const layouts = ['default', 'cover', 'center', 'two-cols', 'two-cols-header', 'quote', 'section', 'statement', 'fact', 'full', 'intro', 'end', 'none'];
const animations = ['none', 'fade', 'fade-in', 'up', 'down', 'left', 'right', 'scale'];
const settings = {
  theme: value => value === 'default',
  layout: value => layouts.includes(value),
  transition: value => transitions.includes(value),
  clickAnimation: value => animations.includes(value),
  zoom: value => /^(?:0\.[0-9]+|1(?:\.0+)?)$/.test(value) && Number(value) >= 0.1,
};

// A deliberately small Slidev subset for the existing local web renderer.
// Never allow frontmatter imports, custom themes, scripts or executable Vue.
export function validateEditedSlides(source) {
  const fail = message => { throw new SlideSourceError(message); };
  if (typeof source !== 'string' || !source.trim() || source.length > 200_000) fail('slides.md 不可空白或超過 200,000 字元。');
  const text = source.replace(/\r\n?/g, '\n');
  if (!text.startsWith('---\n')) fail('slides.md 需以 --- 包住的 Slidev 設定開頭。');
  if (/```|~~~|<<<|\{\{|!\[/.test(text)) fail('目前網頁原稿編輯不支援程式碼區塊、匯入、插值或圖片。');
  const lines = text.split('\n');
  let cursor = 0, count = 0;
  while (cursor < lines.length) {
    if (lines[cursor] !== '---') fail('Slidev 分頁格式不正確。');
    cursor++;
    if (count === 0 || /^[A-Za-z][\w-]*:/.test(lines[cursor] || '')) {
      const used = new Set();
      while (cursor < lines.length && lines[cursor] !== '---') {
        const line = lines[cursor++].trim();
        if (!line || line.startsWith('#')) continue;
        const match = /^([A-Za-z][\w-]*):\s*([^\n]+)$/.exec(line);
        if (!match || !Object.hasOwn(settings, match[1]) || used.has(match[1]) || !settings[match[1]](match[2].trim())) fail('Slidev 設定目前支援 theme: default、內建 layout、transition、clickAnimation 與 zoom（0.1–1）。');
        used.add(match[1]);
      }
      if (lines[cursor++] !== '---') fail('Slidev 設定缺少結尾 ---。');
    }
    const start = cursor;
    while (cursor < lines.length && lines[cursor] !== '---') cursor++;
    const page = lines.slice(start, cursor).join('\n');
    if (++count > 100) fail('簡報最多支援 100 頁。');
    const notes = [...page.matchAll(/<!--[\s\S]*?-->/g)];
    if (notes.length !== 1 || !notes[0][0].slice(4, -3).trim() || page.slice(notes[0].index + notes[0][0].length).trim()) fail(`第 ${count} 頁需在末尾保留一個非空的 <!-- 講稿 -->。`);
    if (/<\/?[A-Za-z]|<!--|-->/.test(notes[0][0].slice(4, -3))) fail('講稿註解內不接受 HTML 或巢狀註解。');
    const body = page.slice(0, notes[0].index);
    if (!/^#\s+\S/m.test(body)) fail(`第 ${count} 頁缺少 # 標題。`);
    let depth = 0;
    const visible = body.replace(/<\/?v-clicks>/g, tag => {
      depth += tag === '<v-clicks>' ? 1 : -1;
      if (depth < 0 || depth > 1) fail('v-clicks 標籤需成對且不可巢狀。');
      return '';
    });
    if (depth || /<[^>]*>|<!--|-->|\{\{|^\s*::(?!right::|left::|default::)/m.test(visible)) fail('目前網頁原稿只支援 Markdown、版面分欄與成對的 <v-clicks>；不接受其他 HTML 或 Vue。');
    for (const link of visible.matchAll(/\]\(([^)]*)\)/g)) {
      if (!/^(?:https:\/\/[^\s<>]+|#[A-Za-z0-9_-]+)$/.test(link[1])) fail('來源連結需使用 HTTPS 網址或頁內錨點。');
    }
    for (const link of visible.matchAll(/^\s{0,3}\[[^\]]+\]:\s*(\S+)/gm)) {
      if (!/^https:\/\//.test(link[1])) fail('參照式來源連結需使用 HTTPS 網址。');
    }
  }
  return source;
}
