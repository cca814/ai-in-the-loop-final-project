import { serveWebSlides } from '../../../../../../slide-export/web.js';

export async function GET(_request, context) {
  if (process.env.NODE_ENV === 'production') return new Response('Local development only', { status: 403 });
  const { id, asset } = await context.params;
  return serveWebSlides(id, asset || []);
}
