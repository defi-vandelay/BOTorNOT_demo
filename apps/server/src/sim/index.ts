/**
 * Dev-only: fills a local game server with simulated players so one person can test
 * player-vs-player rounds and see the payout pools move.
 *
 *   pnpm sim                      4 players, mixed styles, against ws://localhost:8787/ws
 *   pnpm sim --players 8
 *   pnpm sim --styles trickster   only tricksters (comma-separate to mix: honest,sharp)
 *
 * Uses SIM_MODEL (default claude-haiku-4-5) when ANTHROPIC_API_KEY is set, otherwise canned replies
 * and random calls. The server needs DEV_MODE on (the default outside production) so players on one
 * machine can be matched together.
 */
import { parseArgs } from 'node:util';
import { loadConfig } from '../config';
import { AnthropicGateway } from '../llm/anthropic';
import { MockGateway } from '../llm/mock';
import type { LlmGateway } from '../llm/gateway';
import { SIM_STYLES, SimPlayer, type SimStyle } from './player';

const { values } = parseArgs({
  options: {
    players: { type: 'string', default: '4' },
    url: { type: 'string' },
    styles: { type: 'string', default: SIM_STYLES.join(',') },
  },
});

const config = loadConfig();
if (process.env.NODE_ENV === 'production') {
  throw new Error('The simulator is for development only.');
}
const url = values.url ?? `ws://localhost:${config.PORT}/ws`;
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`The simulator only connects to a local server, not ${host}.`);
}

const styles = values.styles.split(',').map((s) => s.trim()) as SimStyle[];
for (const s of styles) {
  if (!SIM_STYLES.includes(s))
    throw new Error(`Unknown style "${s}" (use ${SIM_STYLES.join(', ')})`);
}
const count = Number(values.players);
if (!Number.isInteger(count) || count < 1 || count > 50) {
  throw new Error('--players must be a whole number from 1 to 50');
}

const model = process.env.SIM_MODEL || 'claude-haiku-4-5';
const llm: LlmGateway =
  config.LLM_PROVIDER === 'anthropic'
    ? new AnthropicGateway({ apiKey: config.ANTHROPIC_API_KEY!, model })
    : new MockGateway();

const log = (msg: string) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
const players = Array.from(
  { length: count },
  (_, index) => new SimPlayer({ url, index, style: styles[index % styles.length]!, llm, log }),
);

log(
  `Starting ${count} sim players against ${url} ` +
    `(${config.LLM_PROVIDER === 'anthropic' ? model : 'canned replies, random calls'}): ` +
    players.map((p) => p.label).join(', '),
);
for (const p of players) p.start();

process.on('SIGINT', () => {
  log('Stopping. Balances: ' + players.map((p) => `${p.name} ${p.points ?? '?'}`).join(', '));
  for (const p of players) p.stop();
  process.exit(0);
});
