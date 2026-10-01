import { loadConfig } from './config';
import { createGateway } from './llm/gateway';
import { operatorAccount } from './operator';
import { startServer } from './server';

const config = loadConfig();
const operator = operatorAccount(config.OPERATOR_PRIVATE_KEY);
// Created at boot so a bad API key setup fails fast; used by the bot runtime from M1.
createGateway(config);

startServer(config);
console.log(
  `BOT or NOT server on :${config.PORT} (llm: ${config.LLM_PROVIDER}, operator: ${operator.address})`,
);
if (!config.OPERATOR_PRIVATE_KEY) {
  console.log('No OPERATOR_PRIVATE_KEY set: using a throwaway key for this run.');
}
