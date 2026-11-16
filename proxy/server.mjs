#!/usr/bin/env node
// Reference proxy for the KKU DPA claim filler (spec §5, proxy mode).
//
// Holds the Anthropic API key, identifies the KKU user, applies a per-user daily
// limit, forwards POST /v1/messages to Anthropic and logs usage. It stores no request
// or response bodies. No dependencies: Node 20+.
//
// It does not do the KKU login itself. Run it behind something that does (for example
// Apache or nginx with KKU SSO / OpenID Connect) and that puts the signed-in user in a
// header (TRUSTED_USER_HEADER). That front end must strip the header from incoming
// requests so a client cannot set it. See proxy/README.md.

import http from 'node:http';
import { Readable } from 'node:stream';

const env = (k, d) => process.env[k] ?? d;
const API_KEY = env('ANTHROPIC_API_KEY');
const PORT = Number(env('PORT', '8787'));
const HOST = env('HOST', '127.0.0.1');
const UPSTREAM = env('UPSTREAM', 'https://api.anthropic.com');
const USER_HEADER = env('TRUSTED_USER_HEADER', 'x-remote-user').toLowerCase();
const ALLOWED_ORIGINS = env('ALLOWED_ORIGINS', '').split(',').map((s) => s.trim()).filter(Boolean);
const ALLOWED_USER_PATTERN = new RegExp(env('ALLOWED_USER_PATTERN', '@(kku\\.ac\\.th)$'), 'i');
const DAILY_LIMIT = Number(env('DAILY_REQUEST_LIMIT', '60'));
const MAX_BODY = Number(env('MAX_BODY_MB', '32')) * 1024 * 1024;
const ALLOWED_MODELS = new Set(env('ALLOWED_MODELS', 'claude-sonnet-5-5,claude-haiku-5-5').split(','));
const FORWARD_HEADERS = ['anthropic-version', 'anthropic-beta', 'content-type', 'accept'];

if (!API_KEY) {
  console.error('Set ANTHROPIC_API_KEY.');
  process.exit(1);
}

/** user -> { day, count } */
const usage = new Map();
const today = () => new Date().toISOString().slice(0, 10);

function log(obj) {
  console.log(JSON.stringify({ t: new Date().toISOString(), ...obj }));
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, anthropic-version, anthropic-beta, x-api-key, anthropic-dangerous-direct-browser-access, x-stainless-arch, x-stainless-lang, x-stainless-os, x-stainless-package-version, x-stainless-retry-count, x-stainless-runtime, x-stainless-runtime-version, x-stainless-timeout');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Vary', 'Origin');
  }
  return !origin || ALLOWED_ORIGINS.includes(origin);
}

function fail(res, status, message) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ type: 'error', error: { type: 'proxy_error', message } }));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  const originOk = cors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(originOk ? 204 : 403).end();
    return;
  }
  if (!originOk) return fail(res, 403, 'Origin not allowed');
  if (req.method === 'GET' && req.url === '/healthz') return res.writeHead(200).end('ok');
  if (req.method !== 'POST' || !/^\/v1\/messages(\?|$)/.test(req.url ?? '')) return fail(res, 404, 'Only POST /v1/messages is proxied');

  const user = String(req.headers[USER_HEADER] ?? '').trim();
  if (!user) return fail(res, 401, 'Not signed in to KKU');
  if (!ALLOWED_USER_PATTERN.test(user)) return fail(res, 403, 'User not allowed');

  const u = usage.get(user);
  const day = today();
  const count = u && u.day === day ? u.count : 0;
  if (count >= DAILY_LIMIT) return fail(res, 429, `Daily limit of ${DAILY_LIMIT} requests reached`);

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return fail(res, e.status ?? 400, e.message);
  }
  let model = '';
  try {
    model = JSON.parse(body.toString('utf8')).model ?? '';
  } catch {
    return fail(res, 400, 'Body is not JSON');
  }
  if (!ALLOWED_MODELS.has(model)) return fail(res, 400, `Model ${model} is not allowed`);
  usage.set(user, { day, count: count + 1 });

  const headers = { 'x-api-key': API_KEY };
  for (const h of FORWARD_HEADERS) if (req.headers[h]) headers[h] = req.headers[h];
  headers['anthropic-version'] ??= '2023-06-01';

  const started = Date.now();
  let upstream;
  try {
    upstream = await fetch(`${UPSTREAM}/v1/messages`, { method: 'POST', headers, body });
  } catch (e) {
    log({ user, model, status: 502, error: e.message });
    return fail(res, 502, 'Upstream unreachable');
  }

  const out = {};
  for (const [k, v] of upstream.headers) if (['content-type', 'request-id', 'retry-after'].includes(k)) out[k] = v;
  res.writeHead(upstream.status, out);

  // Stream through; read token counts on the way for the usage log. Bodies are not kept.
  let tail = '';
  let input = 0;
  let output = 0;
  const scan = (text) => {
    tail = (tail + text).slice(-4096);
    for (const m of tail.matchAll(/"input_tokens":(\d+)/g)) input = Math.max(input, Number(m[1]));
    for (const m of tail.matchAll(/"output_tokens":(\d+)/g)) output = Math.max(output, Number(m[1]));
  };
  if (upstream.body) {
    const dec = new TextDecoder();
    for await (const chunk of Readable.fromWeb(upstream.body)) {
      scan(dec.decode(chunk, { stream: true }));
      res.write(chunk);
    }
  }
  res.end();
  log({ user, model, status: upstream.status, ms: Date.now() - started, input_tokens: input, output_tokens: output, today: count + 1 });
});

server.listen(PORT, HOST, () => log({ msg: `proxy listening on http://${HOST}:${PORT}`, origins: ALLOWED_ORIGINS, userHeader: USER_HEADER }));
