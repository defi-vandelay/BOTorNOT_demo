import { loadConfig } from './config';
import { createGateway } from './llm/gateway';
import { startServer } from './server';

const config = loadConfig();
const server = startServer(config, { llm: createGateway(config) });

server.http.once('listening', () => {
  console.log(
    `BOT or NOT server on :${config.PORT} (llm: ${config.LLM_PROVIDER}, bot model: ${config.BOT_MODEL}, dev mode: ${config.DEV_MODE})`,
  );
  if (!config.OPERATOR_PRIVATE_KEY) {
    console.log('No OPERATOR_PRIVATE_KEY set: using a throwaway signing key for this run.');
  }
  const ways = [
    config.INVITE_CODE && 'the invite link',
    config.BETA_USERNAME && 'the beta username and password',
  ].filter(Boolean);
  if (ways.length) console.log(`Private: players need ${ways.join(' or ')}.`);
  else if (!config.DEV_MODE) {
    console.log('No INVITE_CODE or BETA_USERNAME set: anyone with the address can play.');
  }
  if (!config.DEV_MODE) {
    console.log(
      `Daily limits: ${config.ROUNDS_PER_PLAYER_PER_DAY} rounds per player, ` +
        `${config.BOT_ROUNDS_PER_DAY} bot rounds in all, ` +
        `${config.WALLET_ACTIONS_PER_DAY} wallet actions per wallet (0 = no limit).`,
    );
  }
});

// Hosts stop the server with SIGTERM on every deploy: close cleanly so the database is saved.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    console.log(`${signal}: shutting down`);
    void server.close().then(() => process.exit(0));
  });
}
