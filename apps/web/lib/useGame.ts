'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { parseServerMessage, type Call, type ClientMessage } from '@botornot/shared';
import type { Address } from 'viem';
import { guestAccount } from './guest';
import { initialState, reduce } from './game';
import { savedSignIn, signIn, signOut, type WalletSignIn } from './wallet';

const WS_URL = process.env.NEXT_PUBLIC_SERVER_WS_URL ?? 'ws://localhost:8787/ws';
const TYPING_THROTTLE_MS = 1_500;

/** Owns the WebSocket to the game server and exposes the game state plus the player's actions. */
export function useGame() {
  const [state, dispatch] = useReducer(reduce, initialState);
  const wsRef = useRef<WebSocket | null>(null);
  const lastTypingRef = useRef(0);
  // Created after mount: keys live in browser storage, which doesn't exist during server render.
  // A wallet sign-in (on-chain mode) takes over from the per-tab guest key.
  const [guest, setGuest] = useState<ReturnType<typeof guestAccount> | null>(null);
  const [wallet, setWallet] = useState<WalletSignIn | null>(null);
  useEffect(() => {
    setGuest(guestAccount());
    setWallet(savedSignIn());
  }, []);
  const address: Address | null = wallet?.address ?? guest?.address ?? null;

  useEffect(() => {
    if (!address) return;
    dispatch({ type: 'identity' });
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;

    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => {
        dispatch({ type: 'connected', connected: true });
        const auth = wallet
          ? { issuedAt: wallet.issuedAt, signature: wallet.signature }
          : undefined;
        ws.send(JSON.stringify({ type: 'hello', address, auth }));
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
  }, [address, wallet]);

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
      async signIn() {
        setWallet(await signIn());
      },
      signOut() {
        signOut();
        setWallet(null);
      },
      /** After a deposit, withdrawal or session change: ask the server to re-read the chain. */
      walletChanged() {
        send({ type: 'wallet.refresh' });
      },
    }),
    [send],
  );

  return { state, actions, address };
}
