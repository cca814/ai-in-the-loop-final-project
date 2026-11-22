import { createOperation, readRequestJson, OperationError } from '../report-agent/operation.js';
import { withRenderSlot, RenderBusyError } from './render-runtime.js';
import { checkLayout } from './layout-check.js';
import { reportToSlides, ReportFormatError } from './convert.js';
import { exportPptx } from './export.js';
import { buildWebSlides } from './web.js';
import { exportPortable } from './portable.js';
import { planPresentation } from './presentation-plan.js';
import { createClient } from '../report-agent/llm.js';
import { ConfigurationError, ProviderError } from '../report-agent/errors.js';

export function slideHandler(mode, { complete, render = exportPptx, buildWeb = buildWebSlides, archive = exportPortable, inspectLayout = checkLayout, production = process.env.NODE_ENV === 'production' } = {}) {
  return async function POST(request) {
    if (production) return Response.json({ error: '簡報 API 目前僅供本機開發使用。' }, { status: 403 });
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return Response.json({ error: '不允許跨來源請求。' }, { status: 403 });
    let slides, format, body, presentationPlan;
    const operation = createOperation({ signal: request.signal, timeoutMs: 150_000, maxCalls: 2 });
    const signal = operation.signal;
    const renderFailure = error => {
      if (error instanceof RenderBusyError) return Response.json({ error: '本機已有兩個簡報渲染工作，請稍後重試；這不是 LLM 供應商錯誤。', code: 'RENDER_BUSY' }, { status: 503, headers: { 'Retry-After': '5' } });
      if (signal.aborted || error instanceof OperationError) {
        const timeout = signal.reason?.name === 'TimeoutError';
        return Response.json({ error: timeout ? '簡報操作超過時間上限，報告與原稿已保留。' : '簡報操作已取消，報告與原稿已保留。', code: timeout ? 'OPERATION_TIMEOUT' : 'OPERATION_CANCELLED' }, { status: timeout ? 504 : 422 });
      }
      return null;
    };
    try {
      body = await readRequestJson(request, 500_000);
      if (typeof body.report !== 'string' || body.report.length > 100_000) throw new Error('Invalid report');
      // Web reports support Markdown, not executable Vue/HTML components.
      if (/<\/?[a-z][^>]*>|\{\{/i.test(body.report)) throw new Error('Unsupported markup');
      if (body.transition === 'auto' && mode !== 'slides' && body.presentationPlan === undefined) throw new Error('Generate the presentation plan first');
      presentationPlan = body.presentationPlan;
      slides = reportToSlides(body.report, { transition: body.transition === 'auto' ? undefined : body.transition || undefined, presentationPlan });
      format = body.format || 'pptx';
      if (!['pptx', 'pptx-editable'].includes(format)) throw new Error('Unsupported format');
    } catch (error) {
      if (error.code === 'REQUEST_TOO_LARGE') return Response.json({ error: 'Request too large.' }, { status: 413 });
      const message = error instanceof ReportFormatError ? error.publicMessage : '報告格式或匯出選項不符；講稿與來源支援中英文標題，網頁匯出不接受 HTML 或 Vue。';
      return Response.json({ error: message }, { status: 400 });
    }
    if (mode === 'slides') {
      if (body.transition === 'auto' && presentationPlan === undefined) {
        try {
          presentationPlan = await planPresentation(body.report, { complete: operation.wrap(complete || createClient({ signal, onUsage: operation.record })) });
          slides = reportToSlides(body.report, { presentationPlan });
        } catch (error) {
          const stopped = renderFailure(error); if (stopped) return stopped;
          const message = error instanceof ConfigurationError ? '請先設定伺服器的 LLM Provider、模型與 API Key。' : error instanceof ProviderError ? '簡報特效模型暫時無法回覆，請稍後重試；目前報告已保留。' : '模型回覆的簡報特效設定不符格式，請重試；目前報告已保留。';
          return Response.json({ error: message, code: 'SLIDE_PLANNING_FAILED' }, { status: 502 });
        }
      }
      return Response.json({ slides, operation: operation.stats(), ...(presentationPlan ? { presentationPlan } : {}) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (mode === 'layout') {
      try { return Response.json(await withRenderSlot(() => inspectLayout(slides, { signal }), { signal }), { headers: { 'Cache-Control': 'no-store' } }); }
      catch (error) { return renderFailure(error) || Response.json({ error: '無法完成版面檢查。請確認 Chromium 已安裝後重試；未完成檢查不代表版面沒有溢出。', code: 'LAYOUT_CHECK_FAILED' }, { status: 502 }); }
    }
    if (mode === 'web') {
      try {
        return Response.json(await withRenderSlot(() => buildWeb(slides, { signal }), { signal }), { headers: { 'Cache-Control': 'no-store' } });
      } catch (error) {
        const stopped = renderFailure(error); if (stopped) return stopped;
        return Response.json({ error: '網頁簡報建置失敗。請確認 Slidev 依賴已安裝，或稍後重試；目前報告與原稿已保留。' }, { status: 502 });
      }
    }
    if (mode === 'portable') {
      try {
        const file = await withRenderSlot(() => archive(slides, { signal }), { signal });
        return new Response(new Uint8Array(file), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="report-slidev-portable.zip"', 'Cache-Control': 'no-store' } });
      } catch (error) {
        const stopped = renderFailure(error); if (stopped) return stopped;
        return Response.json({ error: '可攜式簡報匯出失敗。請確認 Slidev 已安裝，且報告不含圖片，再重試；目前報告已保留。' }, { status: 502 });
      }
    }
    try {
      const file = await withRenderSlot(() => render(slides, { format, signal }), { signal });
      return new Response(new Uint8Array(file), { headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="report-${format}.pptx"`,
        'Cache-Control': 'no-store',
      } });
    } catch (error) {
      const stopped = renderFailure(error); if (stopped) return stopped;
      return Response.json({ error: 'PPTX 匯出失敗。請確認 slide-export 依賴與 Chromium 已安裝，或稍後重試；報告與 Slidev 原稿已保留。' }, { status: 502 });
    }
  };
}
