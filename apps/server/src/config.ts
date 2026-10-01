import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  LLM_PROVIDER: z.enum(['anthropic', 'mock']).optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  BOT_MODEL: z.string().default('claude-opus-5-5'),
  /** Dev mode lets two browser windows on one machine match each other. */
  DEV_MODE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? process.env.NODE_ENV !== 'production' : v === 'true')),
  /** Share of matches given to a bot. Set to 0 to always try for a human (testing with two windows). */
  BOT_SHARE: z.coerce.number().min(0).max(1).default(0.5),
  /** EIP-712 domain for commitment receipts. Base Sepolia; the vault address arrives in M3. */
  CHAIN_ID: z.coerce.number().int().default(84532),
  GAME_VAULT_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .default('0x0000000000000000000000000000000000000000')
    .transform((v) => v as `0x${string}`),
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
