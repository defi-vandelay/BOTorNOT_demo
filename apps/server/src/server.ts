import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { formatEther } from 'viem';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  SIGN_IN_TTL_MS,
  betaLoginText,
  parseClientMessage,
  signInMessage,
  type ClientMessage,
  type ServerMessage,
} from '@botornot/shared';
import type { Config } from './config';
import type { LlmGateway } from './llm/gateway';
import { CommitService } from './game/commit';
import { Ledger } from './game/ledger';
import { Matchmaker, type Player } from './game/matchmaker';
import { Stats } from './game/stats';
import { operatorAccount } from './operator';
import { Headlines } from './bots/context';
import { Store } from './store';
import { Chain } from './chain/chain';
import type { Bank } from './game/bank';
import { OnchainBank, brief } from './game/onchain-bank';
import { DailyLimits } from './game/limits';

export interface GameServer {
  http: Server;
  matchmaker: Matchmaker;
  stats: Stats;
  ledger: Ledger;
  /** Set when GAME_VAULT_ADDRESS is configured. */
  onchain?: OnchainBank;
  close(): Promise<void>;
}

export interface ServerDeps {
  llm: LlmGateway;
  log?: (msg: string) => void;
}

/**
 * The player's IP. Behind a host's proxy (Railway, Fly.io) it's the last X-Forwarded-For entry,
 * the one the proxy added; earlier entries come from the client and can be made up.
 */
function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  const last = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded)?.split(',').at(-1);
  return last?.trim() || req.socket.remoteAddress || 'unknown';
}

/** Compares an invite code or login without leaking how much of it matched. */
function sameCode(given: string | undefined, expected: string): boolean {
  const digest = (v: string) => createHash('sha256').update(v).digest();
  return given !== undefined && timingSafeEqual(digest(given), digest(expected));
}

const GAS_CHECK_MS = 10 * 60_000;

/** HTTP (/health, /stats) plus the WebSocket game endpoint (/ws). */
export function startServer(config: Config, deps: ServerDeps): GameServer {
  const log = deps.log ?? console.log;
  const operator = operatorAccount(config.OPERATOR_PRIVATE_KEY);
  const commit = new CommitService(operator, config.CHAIN_ID, config.GAME_VAULT_ADDRESS);
  const store = new Store(config.DB_PATH);
  const stats = new Stats(store);
  // What hello.login must be for the beta username and password (see betaLoginKey).
  const loginKey =
    config.BETA_USERNAME && config.BETA_PASSWORD
      ? createHash('sha256')
          .update(betaLoginText(config.BETA_USERNAME, config.BETA_PASSWORD))
          .digest('hex')
      : undefined;
  /** An open server lets everyone in; a private one wants the invite code or the login. */
  const letIn = (msg: Extract<ClientMessage, { type: 'hello' }>) =>
    (!config.INVITE_CODE && !loginKey) ||
    (!!config.INVITE_CODE && sameCode(msg.invite, config.INVITE_CODE)) ||
    (!!loginKey && sameCode(msg.login, loginKey));
  const players = new Set<Player>();
  // A hosted game caps daily rounds and wallet actions; dev mode (one machine) doesn't.
  const limits = config.DEV_MODE
    ? undefined
    : new DailyLimits(store, {
        roundsPerPlayer: config.ROUNDS_PER_PLAYER_PER_DAY,
        botRounds: config.BOT_ROUNDS_PER_DAY,
        walletActions: config.WALLET_ACTIONS_PER_DAY,
      });
  const ledger = new Ledger({
    epochMs: config.EPOCH_MS,
    store,
    refillWhenBroke: config.DEV_MODE,
    onSettled: (epoch, settlement) => {
      if (settlement.rightCalls + settlement.wrongCalls === 0) return;
      log(
        `epoch ${epoch} settled: ${settlement.rightCalls} right, ${settlement.wrongCalls} wrong, ` +
          `+${settlement.profitPerRight} per right call, ${settlement.toDailyPool} to daily pool`,
      );
      for (const p of players) {
        const you = settlement.players[p.address.toLowerCase()];
        if (!you || !p.connected) continue;
        const { right, wrong, deception, net } = you;
        p.seat.deliver({
          type: 'epoch.settled',
          epoch,
          rightCalls: settlement.rightCalls,
          wrongCalls: settlement.wrongCalls,
          profitPerRight: settlement.profitPerRight,
          you: { right, wrong, deception, net },
          dailyPool: ledger.dailyPool,
        });
        p.seat.deliver({ type: 'balance', points: ledger.balance(p.address) });
      }
    },
  });
  ledger.start();

  let onchain: OnchainBank | undefined;
  let chainReady: Promise<void> = Promise.resolve();
  const chain = config.ONCHAIN
    ? new Chain(config.GAME_VAULT_ADDRESS, operator, config.RPC_URL)
    : undefined;
  if (chain) {
    const playersFor = (address: string) =>
      [...players].filter(
        (p) => p.connected && p.mode === 'tokens' && p.address.toLowerCase() === address,
      );
    onchain = new OnchainBank({
      chain,
      store,
      log,
      onBalance: (address) => {
        for (const p of playersFor(address.toLowerCase())) {
          p.seat.deliver(tokenBalance(p.address));
        }
      },
      onEpochSettled: (address, report) => {
        for (const p of playersFor(address.toLowerCase())) {
          p.seat.deliver({ type: 'epoch.settled', ...report });
        }
      },
    });
    const bank = onchain;
    chainReady = chain.init().then(
      () => {
        log(
          `on-chain: GameVault ${chain.vault}, token ${chain.token}, ${chain.epochLength}s pools`,
        );
        bank.start();
        void checkGas();
        gasTimer = setInterval(() => void checkGas(), GAS_CHECK_MS);
      },
      (err: unknown) => {
        log(`on-chain setup failed, wallet play is off: ${String(err)}`);
        throw err;
      },
    );
    chainReady.catch(() => undefined);
  }
  const bank: Bank = onchain ?? ledger;

  /** The operator pays everyone's gas: warn in the logs (and on /health) before it runs out. */
  let gas: { eth: number; low: boolean } | undefined;
  let gasTimer: NodeJS.Timeout | undefined;
  const checkGas = async () => {
    try {
      const eth = Number(formatEther(await chain!.operatorBalance()));
      gas = { eth, low: eth < config.OPERATOR_LOW_ETH };
      if (gas.low) {
        log(
          `WARNING: the operator has ${eth} ETH left for gas. Send it Base Sepolia ETH from a ` +
            `faucet: ${operator.address}`,
        );
      }
    } catch (err) {
      log(`could not read the operator's ETH: ${brief(err)}`);
    }
  };
  const tokenBalance = (address: string): ServerMessage => ({
    type: 'balance',
    points: onchain!.balance(address),
    sessionEndsAt: onchain!.sessionEndsAt(address),
  });
  const headlines = new Headlines(
    config.HEADLINES_RSS_URL === 'off' ? null : config.HEADLINES_RSS_URL,
    log,
  );
  const matchmaker = new Matchmaker({
    commit,
    llm: deps.llm,
    headlines: () => headlines.current(),
    stats,
    ledger: bank,
    botShare: config.BOT_SHARE,
    allowSameIp: config.DEV_MODE,
    onRoundStart: limits && ((ps, bot) => limits.roundStarted(ps, bot)),
    log,
  });
  matchmaker.start();

  const http = createServer((req, res) => {
    const json = (body: unknown) => {
      res.writeHead(200, {
        'content-type': 'application/json',
        'access-control-allow-origin': config.WEB_ORIGIN,
      });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/health') {
      return json({
        ok: true,
        llm: config.LLM_PROVIDER,
        onchain: chain && { operator: operator.address, operatorEth: gas?.eth, lowGas: gas?.low },
      });
    }
    if (req.url === '/stats') return json(stats);
    if (req.url === '/pool') return json(onchain ?? ledger);
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({
    server: http,
    path: '/ws',
    // Browsers always send Origin; only our own web app may connect from one.
    verifyClient: ({ origin }: { origin?: string }) => !origin || origin === config.WEB_ORIGIN,
  });
  let nextId = 1;

  wss.on('connection', (ws: WebSocket, req) => {
    const send = (msg: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };
    let player: Player | null = null;
    let greeting = false;

    /**
     * Without a chain everyone plays for points. With one, a player who signs in with their
     * wallet plays for test tokens, and a guest plays free.
     */
    const hello = async (msg: Extract<ClientMessage, { type: 'hello' }>) => {
      if (greeting) return;
      greeting = true;
      if (!letIn(msg)) {
        const failed = !!loginKey && !!msg.login;
        log(`turned away ${clientIp(req)}: ${failed ? 'wrong login' : 'no valid invite'}`);
        send({
          type: 'invite.required',
          ...(loginKey && { login: true }),
          ...(failed && { failed: true }),
        });
        ws.close(1008, 'invite required');
        return;
      }
      let mode: Player['mode'] = 'points';
      if (chain) {
        mode = 'free';
        if (msg.auth && (await signedIn(msg.address, msg.auth))) mode = 'tokens';
        else if (msg.auth) send({ type: 'error', message: 'wallet sign-in failed' });
      }
      // Read the wallet's balance and session before the welcome, so a join right after works.
      if (mode === 'tokens') await refreshWallet(msg.address, false);
      if (ws.readyState !== ws.OPEN) return;
      const p: Player = {
        id: `p${nextId++}`,
        address: msg.address,
        ip: clientIp(req),
        seat: { kind: 'human', deliver: send },
        connected: true,
        mode,
      };
      player = p;
      players.add(p);
      log(`player ${p.id} connected as ${msg.address} (${mode})`);
      send({
        type: 'welcome',
        playerId: p.id,
        operator: commit.operatorAddress,
        chainId: config.CHAIN_ID,
        verifyingContract: config.GAME_VAULT_ADDRESS,
        mode,
        onchain: chain && {
          vault: chain.vault,
          token: chain.token,
          explorer: chain.explorer,
        },
      });
      if (mode === 'points') send({ type: 'balance', points: ledger.balance(p.address) });
      if (mode === 'tokens') send(tokenBalance(p.address));
    };

    const signedIn = async (
      address: Player['address'],
      auth: { issuedAt: number; signature: `0x${string}` },
    ) => {
      const age = Date.now() - auth.issuedAt;
      if (age > SIGN_IN_TTL_MS || age < -5 * 60_000) return false;
      try {
        await chainReady;
      } catch {
        return false;
      }
      const message = signInMessage({
        address,
        origin: config.WEB_ORIGIN,
        chainId: config.CHAIN_ID,
        issuedAt: auth.issuedAt,
      });
      return chain!.verifySignIn(address, message, auth.signature);
    };

    const refreshWallet = async (address: Player['address'], sendBalance = true) => {
      try {
        await onchain!.refresh(address);
        if (sendBalance) send(tokenBalance(address));
      } catch (err) {
        log(`could not read ${address} from the chain: ${String(err)}`);
        send({ type: 'error', message: 'could not reach the chain, try again' });
      }
    };

    /**
     * A wallet player's signed action. The operator sends the transaction and pays the gas, so a
     * wallet that can only sign (or holds no ETH) can still play. One at a time per connection.
     */
    let walletBusy = false;
    const walletAction = async (
      p: Player,
      action: 'topUp' | 'withdraw',
      run: () => Promise<`0x${string}` | undefined>,
    ) => {
      if (walletBusy) {
        return send({ type: 'wallet.result', action, ok: false, message: 'already on it' });
      }
      const limited = limits?.useWalletAction(p.address);
      if (limited) return send({ type: 'wallet.result', action, ok: false, message: limited });
      walletBusy = true;
      try {
        const txHash = await run();
        log(`player ${p.id}: ${action} done${txHash ? ` (${txHash})` : ''}`);
        await refreshWallet(p.address);
        send({ type: 'wallet.result', action, ok: true, txHash });
      } catch (err) {
        log(`player ${p.id}: ${action} failed: ${brief(err)}`);
        send({ type: 'wallet.result', action, ok: false, message: brief(err) });
      } finally {
        walletBusy = false;
      }
    };

    ws.on('message', (data) => {
      const msg = parseClientMessage(data.toString());
      if (!msg) return send({ type: 'error', message: 'invalid message' });

      if (msg.type === 'hello') {
        if (player) return;
        void hello(msg);
        return;
      }
      if (!player) return send({ type: 'error', message: 'say hello first' });
      const current = player.current;

      switch (msg.type) {
        case 'queue.join': {
          if (current) return send({ type: 'error', message: 'already in a round' });
          const why =
            limits?.whyNotPlay(player) ??
            (player.mode === 'free'
              ? null
              : player.mode === 'tokens'
                ? onchain!.whyNot(player.address)
                : ledger.canStake(player.address)
                  ? null
                  : 'not enough points');
          if (why) return send({ type: 'error', message: why });
          matchmaker.join(player);
          return send({ type: 'queue.waiting' });
        }
        case 'wallet.topUp': {
          if (player.mode !== 'tokens') {
            return send({ type: 'error', message: 'sign in with a wallet first' });
          }
          const { address } = player;
          void walletAction(player, 'topUp', async () => {
            let txHash: `0x${string}` | undefined;
            if (msg.session) {
              txHash = await chain!.startSessionFor(
                address,
                msg.session.days,
                msg.session.signature,
              );
            }
            if (msg.faucet) txHash = await chain!.claimFaucetFor(address);
            return txHash;
          });
          return;
        }
        case 'wallet.withdraw': {
          if (player.mode !== 'tokens') {
            return send({ type: 'error', message: 'sign in with a wallet first' });
          }
          // Stakes for a round in play are still in the vault balance.
          if (current) {
            return send({
              type: 'wallet.result',
              action: 'withdraw',
              ok: false,
              message: 'finish your round first',
            });
          }
          matchmaker.leave(player);
          const { address } = player;
          void walletAction(player, 'withdraw', () =>
            chain!.withdrawAllFor(address, msg.signature),
          );
          return;
        }
        case 'queue.leave':
          return matchmaker.leave(player);
        case 'chat.typing':
          return current?.round.typing(current.seat);
        case 'chat.send':
          if (!current?.round.send(current.seat, msg.text)) {
            send({ type: 'error', message: 'not your turn' });
          }
          return;
        case 'call.submit':
          if (!current?.round.submitCall(current.seat, msg.call)) {
            send({ type: 'error', message: 'cannot call now' });
          }
          return;
      }
    });

    ws.on('close', () => {
      if (!player) return;
      player.connected = false;
      players.delete(player);
      matchmaker.leave(player);
      player.current?.round.leave(player.current.seat);
      log(`player ${player.id} disconnected`);
    });
  });

  http.listen(config.PORT);

  return {
    http,
    matchmaker,
    stats,
    ledger,
    onchain,
    close: () =>
      new Promise((resolve) => {
        matchmaker.stop();
        ledger.stop();
        onchain?.stop();
        clearInterval(gasTimer);
        for (const client of wss.clients) client.terminate();
        wss.close(() =>
          http.close(() => {
            store.close();
            resolve();
          }),
        );
      }),
  };
}
