import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { betaLoginKey, betaLoginText } from '../src';

describe('betaLoginKey', () => {
  it('matches a plain SHA-256 of the login text, so the server can check it with node:crypto', async () => {
    const expected = createHash('sha256').update(betaLoginText('david', 'p@ss word')).digest('hex');
    expect(await betaLoginKey('david', 'p@ss word')).toBe(expected);
  });

  it('ignores case and spaces in the username but not in the password', async () => {
    const key = await betaLoginKey('david', 'Secret-1');
    expect(await betaLoginKey('  David ', 'Secret-1')).toBe(key);
    expect(await betaLoginKey('david', 'secret-1')).not.toBe(key);
    expect(await betaLoginKey('david', 'Secret-1 ')).not.toBe(key);
  });
});
