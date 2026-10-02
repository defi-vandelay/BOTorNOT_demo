import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import { STARTING_POINTS } from '@botornot/shared';
import { loadConfig } from '../src/config';
import { MockGateway } from '../src/llm/mock';
import { startServer, type GameServer } from '../src/server';

let server: GameServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

function start(env: Record<string, string> = {}) {
  server = startServer(
    { ...loadConfig({ HEADLINES_RSS_URL: 'off', DB_PATH: ':memory:', ...env }), PORT: 0 },
    { llm: new MockGateway(), log: () => {} },
  );
  return new Promise<number>((resolve) =>
    server!.http.once('listening', () => resolve((server!.http.address() as AddressInfo).port)),
  );
}

describe('game server', () => {
  it('answers /health', async () => {
    const port = await start();
    const res = await fetch(`http://localhost:${port}/health`);
    expect(await res.json()).toEqual({ ok: true, llm: 'mock' });
  });

  it('reports the payout pool on /pool', async () => {
    const port = await start();
    const res = await fetch(`http://localhost:${port}/pool`);
    expect(await res.json()).toMatchObject({ epoch: 1, pendingCalls: 0, dailyPool: 0 });
  });

  it('welcomes a player after hello and queues them', async () => {
    const port = await start();
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    const messages: unknown[] = [];
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
    await new Promise((resolve) => ws.once('open', resolve));
    ws.send(JSON.stringify({ type: 'hello', address: `0x${'ab'.repeat(20)}` }));
    ws.send(JSON.stringify({ type: 'queue.join' }));
    await expect.poll(() => messages.length).toBe(3);
    expect(messages[0]).toMatchObject({ type: 'welcome', playerId: 'p1', chainId: 84532 });
    expect(messages[1]).toEqual({ type: 'balance', points: STARTING_POINTS });
    expect(messages[2]).toEqual({ type: 'queue.waiting' });
    ws.close();
  });
});

describe('origin check', () => {
  it('rejects browser connections from other sites', async () => {
    const port = await start();
    const ws = new WebSocket(`ws://localhost:${port}/ws`, { origin: 'https://evil.example' });
    const outcome = await new Promise<string>((resolve) => {
      ws.once('open', () => resolve('open'));
      ws.once('error', () => resolve('rejected'));
    });
    expect(outcome).toBe('rejected');
  });
});

describe('paymaster proxy', () => {
  it('forwards only paymaster methods to the upstream URL', async () => {
    const seen: string[] = [];
    const upstream = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += String(c)));
      req.on('end', () => {
        seen.push(body);
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"result":"ok"}');
      });
    });
    await new Promise<void>((r) => upstream.listen(0, r));
    const upstreamPort = (upstream.address() as AddressInfo).port;
    const port = await start({ PAYMASTER_URL: `http://127.0.0.1:${upstreamPort}/pm` });
    const post = (method: string) =>
      fetch(`http://localhost:${port}/paymaster`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }),
      });

    const allowed = await post('pm_getPaymasterStubData');
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ result: 'ok' });
    expect((await post('eth_sendTransaction')).status).toBe(403);
    expect(seen).toHaveLength(1);
    upstream.close();
  });

  it('is off without a paymaster URL', async () => {
    const port = await start();
    const res = await fetch(`http://localhost:${port}/paymaster`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(404);
  });
});
