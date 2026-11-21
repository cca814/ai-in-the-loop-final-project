import { parseReport, ReportFormatError } from '../report-agent/report-format.js';
import { transitions, validatePresentationPlan } from './presentation-plan.js';
export { ReportFormatError };

export function reportToSlides(report, { transition, presentationPlan } = {}) {
  if (transition !== undefined && !transitions.includes(transition)) throw new Error('Unsupported transition');
  if (transition !== undefined && presentationPlan !== undefined) throw new Error('Choose either a manual transition or a presentation plan');
  if (typeof report !== 'string' || !report.trim()) throw new Error('Report is empty');
  const pages = parseReport(report);
  const plan = presentationPlan === undefined ? undefined : validatePresentationPlan(presentationPlan, pages.length);
  const slides = pages.map(({ body, script, sourceSection }, index) => {
    // Image-based PPTX slides do not retain clickable Markdown links. Print the
    // destination as well, so readers can still see the source address.
    const visibleSources = sourceSection.replace(/^(\s*-\s+\[[^\]]+\]\((https:\/\/[^\s)]+)\))\s*$/gm, '$1 — $2');
    const effect = plan?.pages[index];
    let content = body;
    if (effect?.reveal) {
      const titleEnd = body.indexOf('\n');
      if (titleEnd !== -1 && body.slice(titleEnd).trim()) content = `${body.slice(0, titleEnd)}\n\n<v-clicks>\n\n${body.slice(titleEnd).trim()}\n\n</v-clicks>`;
    }
    const settings = effect ? `layout: ${effect.layout}\ntransition: ${effect.transition}\nclickAnimation: ${effect.clickAnimation}\n` : '';
    return { settings, content: `${content}${visibleSources ? `\n\n${visibleSources}` : ''}\n\n<!--\n${script}\n-->` };
  });
  const [first, ...rest] = slides;
  return `---\ntheme: default\n${transition ? `transition: ${transition}\n` : ''}${first.settings}---\n\n${first.content}${rest.map(slide => `\n\n---\n${slide.settings}${slide.settings ? '---\n' : ''}\n${slide.content}`).join('')}\n`;
}
