import { createServer, type IncomingMessage, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { parseClientMessage, type ServerMessage } from '@botornot/shared';
import type { Config } from './config';
import type { LlmGateway } from './llm/gateway';
import { CommitService } from './game/commit';
import { Ledger } from './game/ledger';
import { Matchmaker, type Player } from './game/matchmaker';
import { Stats } from './game/stats';
import { operatorAccount } from './operator';
import { Headlines } from './bots/context';

export interface GameServer {
  http: Server;
  matchmaker: Matchmaker;
  stats: Stats;
  ledger: Ledger;
  close(): Promise<void>;
}

export interface ServerDeps {
  llm: LlmGateway;
  log?: (msg: string) => void;
}

function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return first?.trim() || req.socket.remoteAddress || 'unknown';
}

/** HTTP (/health, /stats) plus the WebSocket game endpoint (/ws). */
export function startServer(config: Config, deps: ServerDeps): GameServer {
  const log = deps.log ?? console.log;
  const operator = operatorAccount(config.OPERATOR_PRIVATE_KEY);
  const commit = new CommitService(operator, config.CHAIN_ID, config.GAME_VAULT_ADDRESS);
  const stats = new Stats();
  const players = new Set<Player>();
  const ledger = new Ledger({
    epochMs: config.EPOCH_MS,
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
  const headlines = new Headlines(
    config.HEADLINES_RSS_URL === 'off' ? null : config.HEADLINES_RSS_URL,
    log,
  );
  const matchmaker = new Matchmaker({
    commit,
    llm: deps.llm,
    headlines: () => headlines.current(),
    stats,
    ledger,
    botShare: config.BOT_SHARE,
    allowSameIp: config.DEV_MODE,
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
    if (req.url === '/health') return json({ ok: true, llm: config.LLM_PROVIDER });
    if (req.url === '/stats') return json(stats);
    if (req.url === '/pool') return json(ledger);
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

    ws.on('message', (data) => {
      const msg = parseClientMessage(data.toString());
      if (!msg) return send({ type: 'error', message: 'invalid message' });

      if (msg.type === 'hello') {
        if (player) return;
        player = {
          id: `p${nextId++}`,
          address: msg.address,
          ip: clientIp(req),
          seat: { kind: 'human', deliver: send },
          connected: true,
        };
        players.add(player);
        log(`player ${player.id} connected as ${msg.address}`);
        send({
          type: 'welcome',
          playerId: player.id,
          operator: commit.operatorAddress,
          chainId: config.CHAIN_ID,
          verifyingContract: config.GAME_VAULT_ADDRESS,
        });
        send({ type: 'balance', points: ledger.balance(player.address) });
        return;
      }
      if (!player) return send({ type: 'error', message: 'say hello first' });
      const current = player.current;

      switch (msg.type) {
        case 'queue.join':
          if (current) return send({ type: 'error', message: 'already in a round' });
          if (!ledger.canStake(player.address)) {
            return send({ type: 'error', message: 'not enough points' });
          }
          matchmaker.join(player);
          return send({ type: 'queue.waiting' });
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
    close: () =>
      new Promise((resolve) => {
        matchmaker.stop();
        ledger.stop();
        for (const client of wss.clients) client.terminate();
        wss.close(() => http.close(() => resolve()));
      }),
  };
}
