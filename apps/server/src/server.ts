import { createServer, type IncomingMessage, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { parseClientMessage, type ServerMessage } from '@botornot/shared';
import type { Config } from './config';
import type { LlmGateway } from './llm/gateway';
import { CommitService } from './game/commit';
import { Matchmaker, type Player } from './game/matchmaker';
import { Stats } from './game/stats';
import { operatorAccount } from './operator';

export interface GameServer {
  http: Server;
  matchmaker: Matchmaker;
  stats: Stats;
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
  const matchmaker = new Matchmaker({
    commit,
    llm: deps.llm,
    stats,
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
        log(`player ${player.id} connected as ${msg.address}`);
        return send({
          type: 'welcome',
          playerId: player.id,
          operator: commit.operatorAddress,
          chainId: config.CHAIN_ID,
          verifyingContract: config.GAME_VAULT_ADDRESS,
        });
      }
      if (!player) return send({ type: 'error', message: 'say hello first' });
      const current = player.current;

      switch (msg.type) {
        case 'queue.join':
          if (current) return send({ type: 'error', message: 'already in a round' });
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
    close: () =>
      new Promise((resolve) => {
        matchmaker.stop();
        for (const client of wss.clients) client.terminate();
        wss.close(() => http.close(() => resolve()));
      }),
  };
}
