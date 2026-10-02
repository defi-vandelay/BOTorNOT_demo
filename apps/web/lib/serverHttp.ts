const WS_URL = process.env.NEXT_PUBLIC_SERVER_WS_URL ?? 'ws://localhost:8787/ws';

/** The game server's HTTP base, derived from its WebSocket URL (ws://host/ws -> http://host). */
export function serverHttpUrl(path: string, wsUrl = WS_URL): string {
  const url = new URL(wsUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = path;
  return url.toString();
}
