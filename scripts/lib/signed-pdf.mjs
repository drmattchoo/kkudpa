// Builds a small multi-page PDF with text and one detached CMS signature (adbe.pkcs7.detached)
// from a throwaway self-signed certificate. Test fixtures only. Needs openssl.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const esc = (t) => t.replace(/[\\()]/g, (c) => '\\' + c);

/**
 * @param {string[][]} pages lines of ASCII text per page
 * @param {{ cn?: string, tmp?: string }} opts
 * @returns {Buffer}
 */
export function makeSignedPdf(pages, { cn = 'Test Signer', tmp } = {}) {
  const dir = tmp ?? fs.mkdtempSync(path.join(os.tmpdir(), 'sigpdf-'));
  const run = (args, input) => execFileSync('openssl', args, { cwd: dir, input, stdio: ['pipe', 'pipe', 'ignore'] });
  if (!fs.existsSync(path.join(dir, 'c.pem'))) {
    run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'k.pem', '-out', 'c.pem', '-days', '3650', '-utf8', '-subj', `/CN=${cn}/O=Test/C=TH`]);
  }
  const SIG_LEN = 8192;
  const n = pages.length;
  // Object numbers: 1 catalog, 2 pages, 3 font, 4 sig field, 5 sig value, then per page: page, content.
  const pageObj = (i) => 6 + i * 2;
  const objs = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R] /SigFlags 3 >> >>';
  objs[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${n} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objs[4] = `<< /Type /Annot /Subtype /Widget /FT /Sig /Rect [0 0 0 0] /T (Signature1) /V 5 0 R /P ${pageObj(0)} 0 R >>`;
  objs[5] = `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0000000000 0000000000 0000000000 0000000000] /Contents <${'0'.repeat(SIG_LEN)}> >>`;
  pages.forEach((lines, i) => {
    const text = lines.map((l, j) => `${j === 0 ? '' : 'T* '}(${esc(l)}) Tj`).join('\n');
    const stream = `BT /F1 12 Tf 56 780 Td 18 TL\n${text}\nET`;
    objs[pageObj(i)] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageObj(i) + 1} 0 R${i === 0 ? ' /Annots [4 0 R]' : ''} >>`;
    objs[pageObj(i) + 1] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });
  let pdf = '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [];
  for (let k = 1; k < objs.length; k++) {
    offsets[k] = pdf.length;
    pdf += `${k} 0 obj\n${objs[k]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  let s = pdf;
  const cStart = s.indexOf('/Contents <') + '/Contents '.length;
  const cEnd = cStart + SIG_LEN + 2;
  const len = Buffer.byteLength(s, 'latin1');
  const br = [0, cStart, cEnd, len - cEnd];
  s = s.replace('[0000000000 0000000000 0000000000 0000000000]', `[${br.map((x) => String(x).padStart(10, '0')).join(' ')}]`);
  const buf = Buffer.from(s, 'latin1');
  const signed = Buffer.concat([buf.subarray(0, br[1]), buf.subarray(br[2])]);
  const der = run(['cms', '-sign', '-binary', '-signer', 'c.pem', '-inkey', 'k.pem', '-outform', 'DER', '-nosmimecap'], signed);
  buf.write(der.toString('hex').padEnd(SIG_LEN, '0'), cStart + 1, 'latin1');
  return buf;
}
