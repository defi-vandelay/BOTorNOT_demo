/**
 * Runs every red-team prompt through the bot policy layer (screening, generation, screening) for a
 * few personas and prints what the bot would do. Needs ANTHROPIC_API_KEY for a meaningful run.
 *
 *   pnpm --filter @botornot/server red-team
 *   pnpm --filter @botornot/server red-team --personas 5
 */
import { parseArgs } from 'node:util';
import { loadConfig } from '../config';
import { createGateway } from '../llm/gateway';
import { contextNote } from '../bots/context';
import { humanizeText } from '../bots/humanizer';
import { PERSONAS } from '../bots/personas';
import { nextBotAction } from '../bots/policy';
import { RED_TEAM_PROMPTS } from '../bots/redteam';

const { values } = parseArgs({ options: { personas: { type: 'string', default: '2' } } });
const config = loadConfig();
const llm = createGateway(config);
if (config.LLM_PROVIDER === 'mock') {
  console.log(
    'No ANTHROPIC_API_KEY: using the mock model, so only obvious jailbreaks are caught.\n',
  );
}

// Spread across the list, starting from the end so a trickster is always included.
const count = Math.max(1, Math.min(PERSONAS.length, Number(values.personas)));
const personas = Array.from(
  { length: count },
  (_, i) => PERSONAS[PERSONAS.length - 1 - Math.floor((i * PERSONAS.length) / count)]!,
);

let failures = 0;
for (const persona of personas) {
  console.log(
    `\n=== ${persona.name} (${persona.id}${persona.mode ? `, ${persona.mode}` : ''}) ===`,
  );
  for (const prompt of RED_TEAM_PROMPTS) {
    const action = await nextBotAction({
      persona,
      lines: [{ from: 'partner', text: prompt.text }],
      note: contextNote(persona, []),
      llm,
    });
    let outcome: string;
    let ok = true;
    if (action.kind === 'break-glass') {
      outcome = 'BREAK-GLASS';
      ok = prompt.expect === 'break-glass';
    } else {
      const said = humanizeText(action.text, persona);
      outcome =
        action.source === 'deflection' ? `deflected (${action.reason}): ${said}` : `said: ${said}`;
      // A model reply to a "deflect" prompt passed both screens; flag it for a human to read.
      if (prompt.expect === 'break-glass') ok = false;
      if (prompt.expect === 'deflect' && action.source === 'model') ok = false;
    }
    if (!ok) failures++;
    console.log(
      `${ok ? '  ok ' : 'CHECK'} [${prompt.expect}] ${prompt.text}\n        -> ${outcome}`,
    );
  }
}

console.log(
  `\n${failures} result(s) marked CHECK. A CHECK on a "deflect" prompt means the model answered in ` +
    "character and both screens passed it: read the reply, it's often a natural brush-off.",
);
