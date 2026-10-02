/**
 * Sizes risk R2 (AI-assisted judges): AI judges play the house bots and we measure how often they
 * call them correctly. Starts its own game server in-process with every match a bot.
 *
 *   pnpm --filter @botornot/server judge-experiment
 *   pnpm --filter @botornot/server judge-experiment --judges 5 --rounds 4
 *
 * The judges chat and call with JUDGE_MODEL (default claude-opus-5-5); the bots use BOT_MODEL.
 * Each round takes about two and a half minutes; judges play in parallel.
 */
import { parseArgs } from 'node:util';
import type { AddressInfo } from 'node:net';
import { loadConfig } from '../config';
import { AnthropicGateway } from '../llm/anthropic';
import { MockGateway } from '../llm/mock';
import { createGateway, type LlmGateway } from '../llm/gateway';
import { startServer } from '../server';
import { SimPlayer } from '../sim/player';

const { values } = parseArgs({
  options: {
    judges: { type: 'string', default: '5' },
    rounds: { type: 'string', default: '4' },
  },
});
const judges = Math.max(1, Number(values.judges));
const rounds = Math.max(1, Number(values.rounds));

const config = loadConfig();
const judgeModel = process.env.JUDGE_MODEL || 'claude-opus-5-5';
const judgeLlm: LlmGateway =
  config.LLM_PROVIDER === 'anthropic'
    ? new AnthropicGateway({ apiKey: config.ANTHROPIC_API_KEY!, model: judgeModel })
    : new MockGateway();
if (config.LLM_PROVIDER === 'mock') {
  console.log('No ANTHROPIC_API_KEY: judges call at random, so the result means nothing.\n');
}

const server = startServer(
  { ...config, PORT: 0, BOT_SHARE: 1, DEV_MODE: true },
  { llm: createGateway(config), log: () => {} },
);
await new Promise((resolve) => server.http.once('listening', resolve));
const url = `ws://localhost:${(server.http.address() as AddressInfo).port}/ws`;

const byPersona = new Map<string, { judged: number; right: number }>();
let noCalls = 0;
let finished = 0;
const log = (msg: string) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
log(`${judges} judges x ${rounds} rounds against house bots (judge model: ${judgeModel})`);

await new Promise<void>((resolve) => {
  for (let index = 0; index < judges; index++) {
    new SimPlayer({
      url,
      index,
      style: 'sharp',
      llm: judgeLlm,
      log,
      maxRounds: rounds,
      onResult: (r) => {
        if (r.correct === null) return void noCalls++;
        const name = r.persona?.name ?? 'unknown';
        const tally = byPersona.get(name) ?? { judged: 0, right: 0 };
        tally.judged++;
        if (r.correct) tally.right++;
        byPersona.set(name, tally);
      },
      onDone: () => {
        if (++finished === judges) resolve();
      },
    }).start();
  }
});

const total = [...byPersona.values()].reduce(
  (sum, t) => ({ judged: sum.judged + t.judged, right: sum.right + t.right }),
  { judged: 0, right: 0 },
);
console.log('\nPersona          judged  spotted');
for (const [name, t] of [...byPersona].sort()) {
  console.log(`${name.padEnd(16)} ${String(t.judged).padStart(6)}  ${String(t.right).padStart(7)}`);
}
const pct = total.judged ? Math.round((100 * total.right) / total.judged) : 0;
console.log(
  `\nAI judges spotted the bot in ${total.right} of ${total.judged} calls (${pct}%), ` +
    `${noCalls} no-calls. The study's human players managed about 60% against bots.`,
);
await server.close();
process.exit(0);
