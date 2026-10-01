import type { Call, CommitmentReceipt, ServerMessage } from '@botornot/shared';

export type Screen = 'lobby' | 'waiting' | 'chat' | 'call' | 'result' | 'void';

export interface ChatLine {
  from: 'you' | 'partner';
  text: string;
  at: number;
}

export type RoundResult = Extract<ServerMessage, { type: 'round.result' }>;
export type Welcome = Extract<ServerMessage, { type: 'welcome' }>;

export interface GameState {
  connected: boolean;
  welcome?: Welcome;
  screen: Screen;
  roundId?: `0x${string}`;
  receipt?: CommitmentReceipt;
  chatEndsAt?: number;
  turn?: { yours: boolean; endsAt: number };
  lines: ChatLine[];
  partnerTypingAt?: number;
  callEndsAt?: number;
  myCall?: Call;
  result?: RoundResult;
  voidReason?: string;
  error?: string;
}

export type Action =
  | { type: 'server'; msg: ServerMessage; now: number }
  | { type: 'connected'; connected: boolean }
  | { type: 'queued' }
  | { type: 'left-queue' }
  | { type: 'called'; call: Call }
  | { type: 'back-to-lobby' };

export const initialState: GameState = { connected: false, screen: 'lobby', lines: [] };

/** Everything the server says, folded into what the screen shows. */
export function reduce(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'connected':
      return action.connected
        ? { ...state, connected: true }
        : { ...state, connected: false, welcome: undefined };
    case 'queued':
      return { ...state, screen: 'waiting', error: undefined };
    case 'left-queue':
      return { ...state, screen: 'lobby' };
    case 'called':
      return { ...state, myCall: action.call };
    case 'back-to-lobby':
      return { ...initialState, connected: state.connected, welcome: state.welcome };
    case 'server':
      return onServer(state, action.msg, action.now);
  }
}

function onServer(state: GameState, msg: ServerMessage, now: number): GameState {
  switch (msg.type) {
    case 'welcome':
      return { ...state, welcome: msg };
    case 'queue.waiting':
      return { ...state, screen: 'waiting' };
    case 'match.found':
      return {
        ...initialState,
        connected: state.connected,
        welcome: state.welcome,
        screen: 'chat',
        roundId: msg.roundId,
        receipt: msg.receipt,
        chatEndsAt: msg.chatEndsAt,
      };
    case 'turn':
      return { ...state, turn: { yours: msg.yours, endsAt: msg.endsAt } };
    case 'chat.typing':
      return { ...state, partnerTypingAt: now };
    case 'chat.message':
      return {
        ...state,
        lines: [...state.lines, { from: msg.from, text: msg.text, at: msg.at }],
        partnerTypingAt: msg.from === 'partner' ? undefined : state.partnerTypingAt,
      };
    case 'call.open':
      return { ...state, screen: 'call', callEndsAt: msg.endsAt, turn: undefined };
    case 'round.result':
      return { ...state, screen: 'result', result: msg };
    case 'round.void':
      return { ...state, screen: 'void', voidReason: msg.reason };
    case 'error':
      return { ...state, error: msg.message };
  }
}

/** The partner's "typing…" shows for this long after their last keystroke ping. */
export const TYPING_VISIBLE_MS = 3_000;
