import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  LLM_PROVIDER: z.enum(['anthropic', 'mock']).optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  BOT_MODEL: z.string().default('claude-opus-5-5'),
  OPERATOR_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'must be a 0x-prefixed 32-byte hex key')
    .optional(),
});

export type Config = Omit<z.infer<typeof schema>, 'LLM_PROVIDER'> & {
  LLM_PROVIDER: 'anthropic' | 'mock';
};

/** Reads config from env. Empty strings count as unset so a copied .env.example works as is. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const parsed = schema.parse(cleaned);
  const provider = parsed.LLM_PROVIDER ?? (parsed.ANTHROPIC_API_KEY ? 'anthropic' : 'mock');
  if (provider === 'anthropic' && !parsed.ANTHROPIC_API_KEY) {
    throw new Error('LLM_PROVIDER=anthropic needs ANTHROPIC_API_KEY');
  }
  return { ...parsed, LLM_PROVIDER: provider };
}
