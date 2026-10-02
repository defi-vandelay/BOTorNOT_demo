import { z } from 'zod';
import { EPOCH_MS } from '@botornot/shared';

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  LLM_PROVIDER: z.enum(['anthropic', 'mock']).optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  BOT_MODEL: z.string().default('claude-opus-5-5'),
  /** Model that screens chat messages going into and out of the bots. Small and fast. */
  MODERATION_MODEL: z.string().default('claude-haiku-4-5'),
  /** RSS feed the bots read headlines from, so "seen the news today?" has an answer. "off": none. */
  HEADLINES_RSS_URL: z.string().default('https://feeds.bbci.co.uk/news/world/rss.xml'),
  /** Dev mode lets two browser windows on one machine match each other. */
  DEV_MODE: z.enum(['true', 'false']).optional(),
  /** Share of matches given to a bot. Set to 0 to always try for a human (testing with two windows). */
  BOT_SHARE: z.coerce.number().min(0).max(1).default(0.5),
  /** Length of a payout pool. Shorten it (e.g. 60000) to see pools settle while testing. */
  EPOCH_MS: z.coerce.number().int().min(5_000).default(EPOCH_MS),
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

export type Config = Omit<z.infer<typeof schema>, 'LLM_PROVIDER' | 'DEV_MODE'> & {
  LLM_PROVIDER: 'anthropic' | 'mock';
  /** On by default outside production. */
  DEV_MODE: boolean;
};

/** Reads config from env. Empty strings count as unset so a copied .env.example works as is. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));
  const parsed = schema.parse(cleaned);
  const provider = parsed.LLM_PROVIDER ?? (parsed.ANTHROPIC_API_KEY ? 'anthropic' : 'mock');
  if (provider === 'anthropic' && !parsed.ANTHROPIC_API_KEY) {
    throw new Error('LLM_PROVIDER=anthropic needs ANTHROPIC_API_KEY');
  }
  const production = env.NODE_ENV === 'production';
  // Dev mode lets one machine play itself and refills points, so it must never reach production.
  if (production && parsed.DEV_MODE === 'true') {
    throw new Error('DEV_MODE=true is not allowed when NODE_ENV=production');
  }
  const devMode = parsed.DEV_MODE === undefined ? !production : parsed.DEV_MODE === 'true';
  return { ...parsed, LLM_PROVIDER: provider, DEV_MODE: devMode };
}
