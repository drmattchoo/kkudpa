#!/usr/bin/env node
// Builds tests/fixtures/pdf/signed.pdf: a minimal PDF with one detached CMS signature
// from a throwaway self-signed certificate (CN "Test Signer ทดสอบ"). Needs openssl.
// Also writes unsigned.pdf and signed-then-modified.pdf (bytes appended after signing).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const out = path.resolve('tests/fixtures/pdf');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sigfx-'));
const run = (args, input) => execFileSync('openssl', args, { cwd: tmp, input });

run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'k.pem', '-out', 'c.pem', '-days', '3650', '-utf8', '-subj', '/CN=Test Signer ทดสอบ/O=Test/C=TH']);

const SIG_LEN = 8192; // hex chars reserved for the CMS blob
const objs = [
  '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R] /SigFlags 3 >> >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Annots [4 0 R] >>',
  '<< /Type /Annot /Subtype /Widget /FT /Sig /Rect [0 0 0 0] /T (Signature1) /V 5 0 R /P 3 0 R >>',
  `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0000000000 0000000000 0000000000 0000000000] /Contents <${'0'.repeat(SIG_LEN)}> >>`,
];
let pdf = '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n';
const offsets = [];
objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
const xref = pdf.length;
pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

let buf = Buffer.from(pdf, 'latin1');
fs.writeFileSync(path.join(out, 'unsigned.pdf'), buf);

const s = buf.toString('latin1');
const cStart = s.indexOf('/Contents <') + '/Contents '.length; // at '<'
const cEnd = cStart + SIG_LEN + 2; // after '>'
const br = [0, cStart, cEnd, buf.length - cEnd];
const brText = `[${br.map((n) => String(n).padStart(10, '0')).join(' ')}]`;
buf = Buffer.from(s.replace(/\[0000000000 0000000000 0000000000 0000000000\]/, brText), 'latin1');
const signedData = Buffer.concat([buf.subarray(br[0], br[1]), buf.subarray(br[2], br[2] + br[3])]);
const der = run(['cms', '-sign', '-binary', '-signer', 'c.pem', '-inkey', 'k.pem', '-outform', 'DER', '-nosmimecap'], signedData);
const hex = der.toString('hex').padEnd(SIG_LEN, '0');
if (hex.length > SIG_LEN) throw new Error('signature too large');
buf.write(hex, cStart + 1, 'latin1');
fs.writeFileSync(path.join(out, 'signed.pdf'), buf);
fs.writeFileSync(path.join(out, 'signed-then-modified.pdf'), Buffer.concat([buf, Buffer.from('\n% appended after signing\n', 'latin1')]));
// Check with openssl that the signature verifies over the byte ranges.
fs.writeFileSync(path.join(tmp, 'data.bin'), signedData);
fs.writeFileSync(path.join(tmp, 'sig.der'), der);
run(['cms', '-verify', '-binary', '-inform', 'DER', '-in', 'sig.der', '-content', 'data.bin', '-noverify', '-out', '/dev/null']);
console.log('wrote signed.pdf, unsigned.pdf, signed-then-modified.pdf; openssl verify OK');
