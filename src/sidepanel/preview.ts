// Renders a page of a PDF (or an image) so the person can compare a value with its
// source. Read and render only; the bytes are never modified (spec §2 rule 2).
import * as pdfjs from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.mjs', location.href).toString();

const cache = new Map<string, Promise<pdfjs.PDFDocumentProxy>>();

function load(id: string, bytes: Uint8Array) {
  if (!cache.has(id)) {
    // pdf.js may transfer the buffer to its worker, so give it a copy.
    cache.set(id, pdfjs.getDocument({ data: bytes.slice() }).promise);
  }
  return cache.get(id)!;
}

export async function pageCount(id: string, bytes: Uint8Array): Promise<number> {
  return (await load(id, bytes)).numPages;
}

export async function renderPage(canvas: HTMLCanvasElement, id: string, bytes: Uint8Array, pageNo: number, rotation = 0, width = 360): Promise<void> {
  const doc = await load(id, bytes);
  const page = await doc.getPage(Math.min(Math.max(1, pageNo), doc.numPages));
  const base = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
  const scale = (width / base.width) * (window.devicePixelRatio || 1);
  const vp = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
  canvas.width = vp.width;
  canvas.height = vp.height;
  canvas.style.width = `${width}px`;
  await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
}

export function forget(id: string) {
  cache.get(id)?.then((d) => d.cleanup()).catch(() => {});
  cache.delete(id);
}
