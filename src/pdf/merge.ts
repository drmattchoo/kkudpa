// "Prepare for signing" (spec §7): merge the scans for one claim line into one
// UNSIGNED PDF that the user then signs in Acrobat. Never use this on signed files
// that are meant for upload: merging breaks their signatures. Images become pages.

import { PDFDocument } from 'pdf-lib';

export interface MergeSource {
  name: string;
  mime: 'application/pdf' | 'image/jpeg' | 'image/png';
  bytes: Uint8Array;
}

const A4 = { w: 595.28, h: 841.89 };

export async function mergeForSigning(sources: MergeSource[]): Promise<Uint8Array> {
  if (sources.length === 0) throw new Error('Nothing to merge');
  const out = await PDFDocument.create();
  out.setTitle('Claim evidence (unsigned, to be signed in Acrobat)');
  out.setProducer('KKU DPA claim filler');
  for (const src of sources) {
    if (src.mime === 'application/pdf') {
      const doc = await PDFDocument.load(src.bytes, { ignoreEncryption: true, updateMetadata: false });
      const pages = await out.copyPages(doc, doc.getPageIndices());
      pages.forEach((p) => out.addPage(p));
    } else {
      const img = src.mime === 'image/png' ? await out.embedPng(src.bytes) : await out.embedJpg(src.bytes);
      const scale = Math.min((A4.w - 40) / img.width, (A4.h - 40) / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      const page = out.addPage([A4.w, A4.h]);
      page.drawImage(img, { x: (A4.w - w) / 2, y: (A4.h - h) / 2, width: w, height: h });
    }
  }
  return out.save();
}
