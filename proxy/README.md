# Reference proxy

A small server that lets a department share one Anthropic API key without putting it in anyone's browser (spec §5, proxy mode). It:

- accepts only `POST /v1/messages` from the extension's origin,
- takes the KKU user from a header set by the SSO front end, and refuses requests without one,
- allows only the configured models and a daily number of requests per user,
- forwards the request to Anthropic with the key and streams the reply back,
- logs one JSON line per request: user, model, status, time and token counts. It does not store documents or replies.

It is a reference, not a hardened service. The Office of Digital Technology should review and deploy it.

## How login works

The proxy does not talk to KKU SSO itself. Put it behind a web server that does, for example Apache with `mod_auth_openidc`, or nginx with an OIDC module, configured against ssonext.kku.ac.th. That front end:

1. requires a KKU login for the proxy's URL,
2. sets the signed-in user's email in a header (default `X-Remote-User`),
3. **removes that header from incoming requests**, so a client cannot fake it.

The extension calls the proxy with `credentials: 'include'`, so the user's SSO session cookie for the proxy's host is sent with each request. The user signs in once in the same browser.

## Run

```bash
ANTHROPIC_API_KEY=... \
ALLOWED_ORIGINS=chrome-extension://<extension id> \
TRUSTED_USER_HEADER=x-remote-user \
node proxy/server.mjs
```

| Variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | (required) | The department's key |
| `ALLOWED_ORIGINS` | none | Comma-separated extension origins, `chrome-extension://<id>` |
| `TRUSTED_USER_HEADER` | `x-remote-user` | Header the SSO front end sets |
| `ALLOWED_USER_PATTERN` | `@(kku\.ac\.th)$` | Regex the user must match |
| `DAILY_REQUEST_LIMIT` | `60` | Requests per user per day (UTC). One file is one request, two with Haiku-first retry |
| `ALLOWED_MODELS` | `claude-sonnet-5-5,claude-haiku-5-5` | Models the proxy will forward |
| `MAX_BODY_MB` | `32` | Largest request (the API's own limit is 32 MB) |
| `HOST`, `PORT` | `127.0.0.1`, `8787` | Listen address. Keep it on localhost behind the front end |

Usage limits are kept in memory and reset when the process restarts. Use a shared store if you run more than one instance.

In the extension: Settings → KKU proxy → enter the proxy URL → Allow access to the proxy.
