import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { AddressInfo } from 'node:net';
import { STARTING_POINTS } from '@botornot/shared';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config';
import { Store } from '../src/store';
import { MockGateway } from '../src/llm/mock';
import { startServer, type GameServer } from '../src/server';

let server: GameServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

function start(env: Record<string, string> = {}, log: (msg: string) => void = () => {}) {
  server = startServer(
    { ...loadConfig({ HEADLINES_RSS_URL: 'off', DB_PATH: ':memory:', ...env }), PORT: 0 },
    { llm: new MockGateway(), log },
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

/** Connects, says hello, and collects what the server sends until it closes. */
async function connect(
  port: number,
  hello: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`, { headers });
  const messages: { type: string; message?: string }[] = [];
  let closed = false;
  ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
  ws.on('close', () => (closed = true));
  await new Promise((resolve) => ws.once('open', resolve));
  ws.send(JSON.stringify({ type: 'hello', address: `0x${'ab'.repeat(20)}`, ...hello }));
  return { ws, messages, closed: () => closed };
}

describe('invite-only', () => {
  it('turns away a player without the invite code, and lets one with it in', async () => {
    const logs: string[] = [];
    const port = await start({ INVITE_CODE: 'letmein-123' }, (msg) => logs.push(msg));

    const stranger = await connect(port, {}, { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' });
    await expect.poll(() => stranger.closed()).toBe(true);
    expect(stranger.messages).toEqual([{ type: 'invite.required' }]);
    // The proxy's own (last) entry is the real IP; the client can make up the earlier ones.
    expect(logs).toContain('turned away 203.0.113.9: no valid invite');

    const wrong = await connect(port, { invite: 'letmein-124' });
    await expect.poll(() => wrong.closed()).toBe(true);
    expect(wrong.messages).toEqual([{ type: 'invite.required' }]);

    const invited = await connect(port, { invite: 'letmein-123' });
    await expect.poll(() => invited.messages[0]?.type).toBe('welcome');
    invited.ws.close();
  });
});

describe('daily limits', () => {
  it("refuses to queue once the day's bot rounds are used up", async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'botornot-')), 'test.db');
    const store = new Store(path);
    store.addUsage(new Date().toISOString().slice(0, 10), 'bot-rounds');
    store.close();
    const port = await start({ DB_PATH: path, DEV_MODE: 'false', BOT_ROUNDS_PER_DAY: '1' });
    const p = await connect(port);
    p.ws.send(JSON.stringify({ type: 'queue.join' }));
    await expect.poll(() => p.messages.at(-1)?.type).toBe('error');
    expect(p.messages.at(-1)?.message).toMatch(/^The game has reached today's round limit/);
    p.ws.close();
  });

  it('are off in dev mode', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'botornot-')), 'test.db');
    const store = new Store(path);
    store.addUsage(new Date().toISOString().slice(0, 10), 'bot-rounds');
    store.close();
    const port = await start({ DB_PATH: path, DEV_MODE: 'true', BOT_ROUNDS_PER_DAY: '1' });
    const p = await connect(port);
    p.ws.send(JSON.stringify({ type: 'queue.join' }));
    await expect.poll(() => p.messages.at(-1)?.type).toBe('queue.waiting');
    p.ws.close();
  });
});
