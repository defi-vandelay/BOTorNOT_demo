'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { parseServerMessage, type Call, type ClientMessage } from '@botornot/shared';
import { guestAccount } from './guest';
import { initialState, reduce } from './game';

const WS_URL = process.env.NEXT_PUBLIC_SERVER_WS_URL ?? 'ws://localhost:8787/ws';
const TYPING_THROTTLE_MS = 1_500;

/** Owns the WebSocket to the game server and exposes the game state plus the player's actions. */
export function useGame() {
  const [state, dispatch] = useReducer(reduce, initialState);
  const wsRef = useRef<WebSocket | null>(null);
  const lastTypingRef = useRef(0);
  // Created after mount: the key lives in sessionStorage, which doesn't exist during server render.
  const [account, setAccount] = useState<ReturnType<typeof guestAccount> | null>(null);
  useEffect(() => setAccount(guestAccount()), []);

  useEffect(() => {
    if (!account) return;
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;

    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => {
        dispatch({ type: 'connected', connected: true });
        ws.send(JSON.stringify({ type: 'hello', address: account.address }));
      };
      ws.onmessage = (event) => {
        const msg = parseServerMessage(String(event.data));
        if (msg) dispatch({ type: 'server', msg, now: Date.now() });
      };
      ws.onclose = () => {
        dispatch({ type: 'connected', connected: false });
        if (!closed) retry = setTimeout(connect, 2_000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      wsRef.current?.close();
    };
  }, [account]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const actions = useMemo(
    () => ({
      findMatch() {
        send({ type: 'queue.join' });
        dispatch({ type: 'queued' });
      },
      cancel() {
        send({ type: 'queue.leave' });
        dispatch({ type: 'left-queue' });
      },
      typing() {
        const now = Date.now();
        if (now - lastTypingRef.current < TYPING_THROTTLE_MS) return;
        lastTypingRef.current = now;
        send({ type: 'chat.typing' });
      },
      say(text: string) {
        lastTypingRef.current = 0;
        send({ type: 'chat.send', text });
      },
      call(call: Call) {
        send({ type: 'call.submit', call });
        dispatch({ type: 'called', call });
      },
      backToLobby() {
        dispatch({ type: 'back-to-lobby' });
      },
      dismissSettlement() {
        dispatch({ type: 'dismiss-settlement' });
      },
    }),
    [send],
  );

  return { state, actions, address: account?.address ?? null };
}
