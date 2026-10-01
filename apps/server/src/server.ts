import { createServer, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { parseClientMessage, type ServerMessage } from '@botornot/shared';
import type { Config } from './config';

export interface GameServer {
  http: Server;
  close(): Promise<void>;
}

function send(ws: WebSocket, msg: ServerMessage) {
  ws.send(JSON.stringify(msg));
}

/**
 * HTTP (/health) plus the WebSocket game endpoint (/ws).
 * M0 only handles the hello handshake; matchmaking and rounds arrive in M1.
 */
export function startServer(config: Config, log: (msg: string) => void = console.log): GameServer {
  const http = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, llm: config.LLM_PROVIDER }));
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({
    server: http,
    path: '/ws',
    // Browsers always send Origin; only our own web app may connect from one.
    verifyClient: ({ origin }: { origin?: string }) => !origin || origin === config.WEB_ORIGIN,
  });
  let nextId = 1;

  wss.on('connection', (ws) => {
    let playerId: string | null = null;

    ws.on('message', (data) => {
      const msg = parseClientMessage(data.toString());
      if (!msg) return send(ws, { type: 'error', message: 'invalid message' });

      if (msg.type === 'hello') {
        playerId = `p${nextId++}`;
        log(`player ${playerId} connected as ${msg.address}`);
        return send(ws, { type: 'welcome', playerId });
      }
      if (!playerId) return send(ws, { type: 'error', message: 'say hello first' });
      send(ws, { type: 'error', message: `${msg.type} is not available yet` });
    });
  });

  http.listen(config.PORT);

  return {
    http,
    close: () =>
      new Promise((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => http.close(() => resolve()));
      }),
  };
}
