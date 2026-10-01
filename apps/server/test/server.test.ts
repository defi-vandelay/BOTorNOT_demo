import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { AddressInfo } from 'node:net';
import { loadConfig } from '../src/config';
import { startServer, type GameServer } from '../src/server';

let server: GameServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

function start() {
  server = startServer({ ...loadConfig({}), PORT: 0 }, () => {});
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

  it('welcomes a player after hello', async () => {
    const port = await start();
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    await new Promise((resolve) => ws.once('open', resolve));
    ws.send(JSON.stringify({ type: 'hello', address: `0x${'ab'.repeat(20)}` }));
    const reply = await new Promise<string>((resolve) =>
      ws.once('message', (data) => resolve(data.toString())),
    );
    expect(JSON.parse(reply)).toEqual({ type: 'welcome', playerId: 'p1' });
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
