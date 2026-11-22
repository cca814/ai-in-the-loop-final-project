import JSZip from 'jszip';
import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { buildWebSlides } from './web.js';

const instructions = `Slidev 可攜式網頁簡報

1. 將 ZIP 完整解壓縮，保留資料夾結構。
2. 播放電腦需已安裝 Node.js 22.12 或更新版本。
3. Windows：雙擊 start.cmd。其他系統：在此資料夾執行 node serve.mjs。
4. 用瀏覽器開啟終端機顯示的 http://127.0.0.1:.../ 網址。
5. 用方向鍵切頁；播放期間保留終端機，結束時按 Ctrl+C。

不需要原本的網站、Next.js、npm install、LLM 或 API Key。
請勿直接雙擊 site/index.html；瀏覽器模組需要 HTTP 伺服器。
此版本使用電腦的系統字型，可離線播放文字簡報及轉場，字型可能與原網站不同。
外部來源連結需要網路。此下載功能不接受圖片，避免遺漏外部圖片資源。
slides.md 是保留原文的 Slidev 原稿；編輯它不會自動更新 site 中已建置的網頁。
請只下載並執行你信任的簡報資料夾。本機伺服器只監聽 127.0.0.1。
`;

export async function exportPortable(slides, { build = buildWebSlides, signal } = {}) {
  // Until image asset bundling is supported, fail explicitly rather than ship
  // a supposedly portable deck with broken external/local image references.
  if (/!\[[^\]]*\]\s*(?:\(|\[)/.test(slides) || /^\s*\[[^\]]+\]:/m.test(slides)) throw new Error('Portable images are not supported');
  const { directory } = await build(slides, { portable: true, signal });
  try {
    const zip = new JSZip();
    const folder = zip.folder('presentation');
    async function addFiles(path, target) {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        if (entry.isDirectory()) await addFiles(join(path, entry.name), target.folder(entry.name));
        else if (entry.isFile()) target.file(entry.name, await readFile(join(path, entry.name)));
      }
    }
    await addFiles(join(directory, 'dist'), folder.folder('site'));
    folder.file('slides.md', slides);
    folder.file('serve.mjs', await readFile(new URL('./portable-server.mjs', import.meta.url)));
    folder.file('start.cmd', '@echo off\r\ncd /d "%~dp0"\r\nwhere node >nul 2>nul\r\nif errorlevel 1 (\r\n  echo Please install Node.js 22.12 or newer, then run this file again.\r\n  pause\r\n  exit /b 1\r\n)\r\nnode serve.mjs\r\npause\r\n');
    folder.file('README.txt', '\uFEFF' + instructions);
    return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
