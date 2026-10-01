'use client';

import { useEffect, useRef, useState } from 'react';
import { parseServerMessage, type ClientMessage, type ServerMessage } from '@botornot/shared';
import { guestAccount } from './guest';

export type SocketStatus = 'connecting' | 'connected' | 'offline';

const WS_URL = process.env.NEXT_PUBLIC_SERVER_WS_URL ?? 'ws://localhost:8787/ws';

/** Connects to the game server, says hello as the guest, and exposes the latest message. */
export function useGameSocket(onMessage?: (msg: ServerMessage) => void) {
  const [status, setStatus] = useState<SocketStatus>('connecting');
  const [playerId, setPlayerId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const handler = useRef(onMessage);
  handler.current = onMessage;

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'hello', address: guestAccount().address }));
    };
    ws.onmessage = (event) => {
      const msg = parseServerMessage(String(event.data));
      if (!msg) return;
      if (msg.type === 'welcome') {
        setPlayerId(msg.playerId);
        setStatus('connected');
      }
      handler.current?.(msg);
    };
    ws.onclose = () => setStatus('offline');
    return () => ws.close();
  }, []);

  const send = (msg: ClientMessage) => wsRef.current?.send(JSON.stringify(msg));
  return { status, playerId, send };
}
