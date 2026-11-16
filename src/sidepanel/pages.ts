// Turns a signed PDF into what the gateway can read: one JPEG and the text layer per
// page. Render and read only; the PDF bytes are never changed (spec §2 rule 2).
import * as pdfjs from 'pdfjs-dist';
import type { PageInput } from '../extraction/client';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.mjs', location.href).toString();

export const MAX_PAGES = 20;

export async function pdfToPages(bytes: Uint8Array, opts: { images: boolean; maxPx: number }): Promise<PageInput[]> {
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  try {
    if (doc.numPages > MAX_PAGES) throw new Error(`The file has ${doc.numPages} pages; the limit is ${MAX_PAGES}.`);
    const out: PageInput[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      const text = tc.items.map((i) => ('str' in i ? i.str + (i.hasEOL ? '\n' : ' ') : '')).join('').replace(/[ \t]+\n/g, '\n').trim();
      let imageDataUrl: string | null = null;
      if (opts.images) {
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(opts.maxPx / Math.max(base.width, base.height), 3);
        const vp = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(vp.width);
        canvas.height = Math.round(vp.height);
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
        imageDataUrl = canvas.toDataURL('image/jpeg', 0.85);
      }
      out.push({ page: n, imageDataUrl, text });
      page.cleanup();
    }
    return out;
  } finally {
    await task.destroy();
  }
}
