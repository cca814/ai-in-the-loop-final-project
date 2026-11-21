import { reportToSlides, ReportFormatError } from './convert.js';
import { exportPptx } from './export.js';
import { buildWebSlides } from './web.js';
import { exportPortable } from './portable.js';
import { planPresentation } from './presentation-plan.js';
import { createClient } from '../report-agent/llm.js';
import { ConfigurationError, ProviderError } from '../report-agent/errors.js';

export function slideHandler(mode, { complete, render = exportPptx, buildWeb = buildWebSlides, archive = exportPortable, production = process.env.NODE_ENV === 'production' } = {}) {
  return async function POST(request) {
    if (production) return Response.json({ error: '簡報 API 目前僅供本機開發使用。' }, { status: 403 });
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return Response.json({ error: '不允許跨來源請求。' }, { status: 403 });
    let slides, format, body, presentationPlan;
    try {
      const text = await request.text();
      if (text.length > 150_000) return Response.json({ error: '報告過大。' }, { status: 413 });
      body = JSON.parse(text);
      if (typeof body.report !== 'string' || body.report.length > 100_000) throw new Error('Invalid report');
      // Web reports support Markdown, not executable Vue/HTML components.
      if (/<\/?[a-z][^>]*>|\{\{/i.test(body.report)) throw new Error('Unsupported markup');
      if (body.transition === 'auto' && mode !== 'slides' && body.presentationPlan === undefined) throw new Error('Generate the presentation plan first');
      presentationPlan = body.presentationPlan;
      slides = reportToSlides(body.report, { transition: body.transition === 'auto' ? undefined : body.transition || undefined, presentationPlan });
      format = body.format || 'pptx';
      if (!['pptx', 'pptx-editable'].includes(format)) throw new Error('Unsupported format');
    } catch (error) {
      const message = error instanceof ReportFormatError ? error.publicMessage : '報告格式或匯出選項不符；講稿與來源支援中英文標題，網頁匯出不接受 HTML 或 Vue。';
      return Response.json({ error: message }, { status: 400 });
    }
    if (mode === 'slides') {
      if (body.transition === 'auto' && presentationPlan === undefined) {
        try {
          presentationPlan = await planPresentation(body.report, { complete: complete || createClient() });
          slides = reportToSlides(body.report, { presentationPlan });
        } catch (error) {
          const message = error instanceof ConfigurationError ? '請先設定伺服器的 LLM Provider、模型與 API Key。' : error instanceof ProviderError ? '簡報特效模型暫時無法回覆，請稍後重試；目前報告已保留。' : '模型回覆的簡報特效設定不符格式，請重試；目前報告已保留。';
          return Response.json({ error: message, code: 'SLIDE_PLANNING_FAILED' }, { status: 502 });
        }
      }
      return Response.json({ slides, ...(presentationPlan ? { presentationPlan } : {}) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (mode === 'web') {
      try {
        return Response.json(await buildWeb(slides), { headers: { 'Cache-Control': 'no-store' } });
      } catch {
        return Response.json({ error: '網頁簡報建置失敗。請確認 Slidev 依賴已安裝，或稍後重試；目前報告與原稿已保留。' }, { status: 502 });
      }
    }
    if (mode === 'portable') {
      try {
        const file = await archive(slides);
        return new Response(new Uint8Array(file), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="report-slidev-portable.zip"', 'Cache-Control': 'no-store' } });
      } catch {
        return Response.json({ error: '可攜式簡報匯出失敗。請確認 Slidev 已安裝，且報告不含圖片，再重試；目前報告已保留。' }, { status: 502 });
      }
    }
    try {
      const file = await render(slides, { format });
      return new Response(new Uint8Array(file), { headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="report-${format}.pptx"`,
        'Cache-Control': 'no-store',
      } });
    } catch {
      return Response.json({ error: 'PPTX 匯出失敗。請確認 slide-export 依賴與 Chromium 已安裝，或稍後重試；報告與 Slidev 原稿已保留。' }, { status: 502 });
    }
  };
}
