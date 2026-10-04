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

  it('takes an optional invite code that fits in a link', () => {
    expect(loadConfig({}).INVITE_CODE).toBeUndefined();
    expect(loadConfig({ INVITE_CODE: 'spring-test_42' }).INVITE_CODE).toBe('spring-test_42');
    expect(() => loadConfig({ INVITE_CODE: 'abc' })).toThrow(/INVITE_CODE/);
    expect(() => loadConfig({ INVITE_CODE: 'has spaces in it' })).toThrow(/INVITE_CODE/);
  });

  it('has daily limits by default, and 0 turns one off', () => {
    const config = loadConfig({ BOT_ROUNDS_PER_DAY: '0' });
    expect(config.ROUNDS_PER_PLAYER_PER_DAY).toBe(40);
    expect(config.BOT_ROUNDS_PER_DAY).toBe(0);
    expect(config.WALLET_ACTIONS_PER_DAY).toBe(10);
  });

  it('plays on-chain only when a vault is set, and then needs the operator key', () => {
    expect(loadConfig({}).ONCHAIN).toBe(false);
    const vault = `0x${'12'.repeat(20)}`;
    expect(() => loadConfig({ GAME_VAULT_ADDRESS: vault })).toThrow(/OPERATOR_PRIVATE_KEY/);
    const key = `0x${'34'.repeat(32)}`;
    expect(loadConfig({ GAME_VAULT_ADDRESS: vault, OPERATOR_PRIVATE_KEY: key }).ONCHAIN).toBe(true);
  });
});
