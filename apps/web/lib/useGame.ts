'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { betaLoginKey, parseServerMessage, type Call, type ClientMessage } from '@botornot/shared';
import type { Address } from 'viem';
import { guestAccount } from './guest';
import { inviteCode, saveLogin, savedLogin } from './invite';
import { initialState, reduce } from './game';
import { currentWallet, returningFromSocial } from './embedded';
import {
  lastWalletKind,
  savedSignIn,
  signInWithEmbedded,
  signOut,
  type WalletSignIn,
} from './wallet';

const WS_URL = process.env.NEXT_PUBLIC_SERVER_WS_URL ?? 'ws://localhost:8787/ws';
const TYPING_THROTTLE_MS = 1_500;

/** Owns the WebSocket to the game server and exposes the game state plus the player's actions. */
export function useGame() {
  const [state, dispatch] = useReducer(reduce, initialState);
  const wsRef = useRef<WebSocket | null>(null);
  const lastTypingRef = useRef(0);
  // The signed top-up or withdrawal waiting for the server's wallet.result.
  const pendingRef = useRef<{ resolve: () => void; reject: (err: Error) => void } | null>(null);
  // Turned away for want of an invite or login: retrying won't help until there is one.
  const deniedRef = useRef(false);
  // Connects again straight away, after the player signs in with the beta login.
  const reconnectRef = useRef<(() => void) | null>(null);
  // Created after mount: keys live in browser storage, which doesn't exist during server render.
  // A wallet sign-in (on-chain mode) takes over from the per-tab guest key.
  const [guest, setGuest] = useState<ReturnType<typeof guestAccount> | null>(null);
  const [wallet, setWallet] = useState<WalletSignIn | null>(null);
  // Picking up an email or social sign-in when the page loads (see resumeEmbedded).
  const [resuming, setResuming] = useState<'working' | { error: string } | null>(null);
  useEffect(() => {
    inviteCode(); // picks up ?invite= from an invite link
    setGuest(guestAccount());
    const saved = savedSignIn();
    setWallet(saved);
    if (!saved && (returningFromSocial() || lastWalletKind() === 'embedded')) {
      setResuming('working');
      resumeEmbedded().then(
        (signIn) => {
          if (signIn) setWallet(signIn);
          setResuming(null);
        },
        (err: unknown) => setResuming({ error: friendlyError(err) }),
      );
    }
  }, []);
  const address: Address | null = wallet?.address ?? guest?.address ?? null;

  useEffect(() => {
    if (!address) return;
    dispatch({ type: 'identity' });
    deniedRef.current = false;
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
        ws.send(
          JSON.stringify({
            type: 'hello',
            address,
            auth,
            invite: inviteCode(),
            login: savedLogin(),
          }),
        );
      };
      ws.onmessage = (event) => {
        const msg = parseServerMessage(String(event.data));
        if (!msg) return;
        if (msg.type === 'invite.required') {
          deniedRef.current = true;
          if (msg.failed) saveLogin(undefined);
        }
        if (msg.type === 'wallet.result') {
          const pending = pendingRef.current;
          pendingRef.current = null;
          if (msg.ok) pending?.resolve();
          else pending?.reject(new Error(msg.message ?? 'it did not go through'));
        }
        dispatch({ type: 'server', msg, now: Date.now() });
      };
      ws.onclose = () => {
        pendingRef.current?.reject(new Error('lost the connection to the game, try again'));
        pendingRef.current = null;
        dispatch({ type: 'connected', connected: false });
        if (!closed && !deniedRef.current) retry = setTimeout(connect, 2_000);
      };
    };
    connect();
    reconnectRef.current = () => {
      deniedRef.current = false;
      clearTimeout(retry);
      connect();
    };
    return () => {
      closed = true;
      reconnectRef.current = null;
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
      /** Runs one of wallet.ts's sign-ins and switches the game over to that wallet. */
      async signIn(how: () => Promise<WalletSignIn>) {
        setResuming(null);
        setWallet(await how());
      },
      signOut() {
        void signOut();
        setWallet(null);
      },
      /** Signs in to a private server with the beta username and password. */
      async logIn(username: string, password: string) {
        const key = await betaLoginKey(username, password);
        dispatch({ type: 'logging-in' });
        saveLogin(key);
        reconnectRef.current?.();
      },
      /** Sends a signed top-up or withdrawal; resolves once the server has put it on-chain. */
      wallet(msg: Extract<ClientMessage, { type: 'wallet.topUp' | 'wallet.withdraw' }>) {
        return new Promise<void>((resolve, reject) => {
          const ws = wsRef.current;
          if (ws?.readyState !== WebSocket.OPEN) {
            return reject(new Error('not connected to the game, try again'));
          }
          pendingRef.current?.reject(new Error('replaced by a newer request'));
          pendingRef.current = { resolve, reject };
          ws.send(JSON.stringify(msg));
        });
      },
    }),
    [send],
  );

  return { state, actions, address, wallet, resuming };
}

/**
 * Signs a returning email or social player back in to the game without asking again: back from
 * Google, Apple or X, or here again after the day-long game sign-in ran out while they're still
 * signed in with Coinbase. Null if they aren't signed in with Coinbase any more.
 */
async function resumeEmbedded(): Promise<WalletSignIn | null> {
  const social = returningFromSocial(); // read before the SDK tidies the address bar
  const address = await currentWallet();
  if (address) return signInWithEmbedded(address);
  if (social) throw new Error("that sign-in didn't finish, please try again");
  await signOut(); // signed out with Coinbase too, so stop checking on every visit
  return null;
}

function friendlyError(err: unknown): string {
  return err instanceof Error ? err.message : 'something went wrong, please try again';
}
