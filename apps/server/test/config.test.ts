import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('uses the mock LLM when no API key is set', () => {
    expect(loadConfig({}).LLM_PROVIDER).toBe('mock');
  });

  it('uses Anthropic when a key is set', () => {
    expect(loadConfig({ ANTHROPIC_API_KEY: 'sk-test' }).LLM_PROVIDER).toBe('anthropic');
  });

  it('treats empty values from a copied .env.example as unset', () => {
    const config = loadConfig({
      LLM_PROVIDER: '',
      ANTHROPIC_API_KEY: '',
      OPERATOR_PRIVATE_KEY: '',
    });
    expect(config.LLM_PROVIDER).toBe('mock');
    expect(config.OPERATOR_PRIVATE_KEY).toBeUndefined();
  });

  it('refuses anthropic without a key', () => {
    expect(() => loadConfig({ LLM_PROVIDER: 'anthropic' })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('turns dev mode on by default outside production only', () => {
    expect(loadConfig({}).DEV_MODE).toBe(true);
    expect(loadConfig({ NODE_ENV: 'production' }).DEV_MODE).toBe(false);
    expect(loadConfig({ DEV_MODE: 'false' }).DEV_MODE).toBe(false);
  });

  it('refuses to start with dev mode on in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', DEV_MODE: 'true' })).toThrow(/DEV_MODE/);
  });
});
