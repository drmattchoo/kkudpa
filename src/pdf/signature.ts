// Local signature check (spec §5.3). Read-only: finds /ByteRange + /Contents of each
// signature field, decodes the PKCS#7/CMS blob with pkijs and reads the signer's
// common name. It does not validate the certificate chain; DPA's SIGNED BY column is
// the final check.

import * as asn1js from 'asn1js';
import { Certificate, ContentInfo, SignedData, IssuerAndSerialNumber } from 'pkijs';
import type { SignatureInfo } from '../shared/types';

const OID_CN = '2.5.4.3';
const OID_SIGNING_TIME = '1.2.840.113549.1.9.5';

/** Bytes -> latin1 string, so byte offsets equal string offsets. */
function latin1(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return s;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

/** Trim the zero padding PDF writers add after the DER blob. */
function trimDer(der: Uint8Array): ArrayBuffer {
  // DER SEQUENCE: 0x30, then a length. Use the encoded length when we can read it.
  if (der[0] === 0x30 && der.length > 4) {
    const l = der[1]!;
    let len = -1;
    let hdr = 2;
    if (l < 0x80) len = l;
    else {
      const n = l & 0x7f;
      len = 0;
      for (let i = 0; i < n; i++) len = (len << 8) | der[2 + i]!;
      hdr = 2 + n;
    }
    if (len > 0 && hdr + len <= der.length) return der.slice(0, hdr + len).buffer;
  }
  return der.slice().buffer;
}

function commonName(cert: Certificate): string | null {
  for (const tv of cert.subject.typesAndValues) {
    if (tv.type === OID_CN) return tv.value.valueBlock.value as string;
  }
  return null;
}

function parseCms(der: Uint8Array): { signerName: string | null; signingTime: string | null } {
  const asn = asn1js.fromBER(trimDer(der));
  if (asn.offset === -1) throw new Error('Signature blob is not valid DER');
  const ci = new ContentInfo({ schema: asn.result });
  const sd = new SignedData({ schema: ci.content });
  const si = sd.signerInfos[0];
  const certs = (sd.certificates ?? []).filter((c): c is Certificate => c instanceof Certificate);
  let signer: Certificate | undefined;
  if (si && si.sid instanceof IssuerAndSerialNumber) {
    const sid = si.sid;
    signer = certs.find((c) => c.serialNumber.isEqual(sid.serialNumber) && c.issuer.isEqual(sid.issuer));
  }
  signer ??= certs[0];
  let signingTime: string | null = null;
  const attr = si?.signedAttrs?.attributes.find((a) => a.type === OID_SIGNING_TIME);
  const v = attr?.values[0] as { toDate?: () => Date } | undefined;
  if (v?.toDate) signingTime = v.toDate().toISOString();
  return { signerName: signer ? commonName(signer) : null, signingTime };
}

export function checkSignatures(bytes: Uint8Array): SignatureInfo {
  const s = latin1(bytes);
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  const signatures: SignatureInfo['signatures'] = [];
  const errors: string[] = [];
  let parsed = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const [a, b, c, d] = m.slice(1).map(Number) as [number, number, number, number];
    if (b === 0 && c === 0 && d === 0) continue; // unfilled placeholder, not a signature
    // The signature hex string sits in the gap between the two signed ranges.
    const gap = s.slice(a + b, c);
    const hex = /<([0-9a-fA-F\s]+)>/.exec(gap)?.[1];
    const coversWholeFile = c + d === bytes.length;
    if (!hex) {
      errors.push('A /ByteRange has no /Contents blob');
      signatures.push({ signerName: null, signingTime: null, coversWholeFile });
      continue;
    }
    try {
      signatures.push({ ...parseCms(hexToBytes(hex)), coversWholeFile });
      parsed++;
    } catch (e) {
      errors.push((e as Error).message);
      signatures.push({ signerName: null, signingTime: null, coversWholeFile });
    }
  }
  return {
    signed: parsed > 0,
    signatures,
    ...(errors.length ? { error: errors.join('; ') } : {}),
  };
}
