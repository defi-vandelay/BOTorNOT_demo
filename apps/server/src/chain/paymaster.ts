import type { IncomingMessage, ServerResponse } from 'node:http';

/** The only JSON-RPC methods the wallet needs from a paymaster (ERC-7677). */
const ALLOWED = new Set(['pm_getPaymasterStubData', 'pm_getPaymasterData']);
const MAX_BODY = 64 * 1024;

/**
 * Forwards the wallet's gas-sponsorship requests to the Coinbase paymaster, so its URL (which
 * carries an API key) never reaches the browser. The paymaster's own contract allowlist decides
 * what actually gets sponsored.
 */
export async function proxyPaymaster(
  req: IncomingMessage,
  res: ServerResponse,
  upstream: string,
  origin: string,
): Promise<void> {
  const cors = {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  };
  if (req.method === 'OPTIONS') return void res.writeHead(204, cors).end();
  if (req.method !== 'POST') return void res.writeHead(405, cors).end();

  let body = '';
  for await (const chunk of req) {
    body += String(chunk);
    if (body.length > MAX_BODY) return void res.writeHead(413, cors).end();
  }
  let method: unknown;
  try {
    method = (JSON.parse(body) as { method?: unknown }).method;
  } catch {
    return void res.writeHead(400, cors).end();
  }
  if (typeof method !== 'string' || !ALLOWED.has(method)) {
    return void res.writeHead(403, cors).end();
  }
  try {
    const upstreamRes = await fetch(upstream, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    res.writeHead(upstreamRes.status, { ...cors, 'content-type': 'application/json' });
    res.end(await upstreamRes.text());
  } catch {
    res.writeHead(502, cors).end();
  }
}
