import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { checkSignatures } from '../../src/pdf/signature';
import { sha256Hex, bytesToBase64, base64ToBytes } from '../../src/pdf/hash';
import { mergeForSigning } from '../../src/pdf/merge';
import { PDFDocument } from 'pdf-lib';

const fx = (n: string) => new Uint8Array(fs.readFileSync(`tests/fixtures/pdf/${n}`));

describe('signature check', () => {
  it('reads the signer common name and signing time', () => {
    const r = checkSignatures(fx('signed.pdf'));
    expect(r.signed).toBe(true);
    expect(r.signatures).toHaveLength(1);
    expect(r.signatures[0]!.signerName).toBe('Test Signer ทดสอบ');
    expect(r.signatures[0]!.signingTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.signatures[0]!.coversWholeFile).toBe(true);
    expect(r.error).toBeUndefined();
  });
  it('reports an unsigned PDF as unsigned', () => {
    // The unsigned file has the placeholder dictionary but an all-zero blob.
    expect(checkSignatures(fx('unsigned.pdf'))).toEqual({ signed: false, signatures: [] });
    const plain = new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
    expect(checkSignatures(plain)).toEqual({ signed: false, signatures: [] });
  });
  it('detects bytes added after signing', () => {
    expect(checkSignatures(fx('signed-then-modified.pdf')).signatures[0]!.coversWholeFile).toBe(false);
  });
});

describe('hashing and base64', () => {
  it('hashes bytes with SHA-256', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('round-trips base64 without changing bytes', () => {
    const b = fx('signed.pdf');
    expect(base64ToBytes(bytesToBase64(b))).toEqual(b);
  });
});

describe('prepare for signing', () => {
  it('merges PDFs and images into one unsigned PDF', async () => {
    const a = await PDFDocument.create();
    a.addPage();
    a.addPage();
    // 1×1 PNG
    const png = base64ToBytes('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==');
    const merged = await mergeForSigning([
      { name: 'a.pdf', mime: 'application/pdf', bytes: await a.save() },
      { name: 'b.png', mime: 'image/png', bytes: png },
    ]);
    const doc = await PDFDocument.load(merged);
    expect(doc.getPageCount()).toBe(3);
    expect(checkSignatures(merged).signed).toBe(false);
  });
});
