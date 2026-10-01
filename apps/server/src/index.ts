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
});
