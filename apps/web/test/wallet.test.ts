import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyMessage, type Address } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { signInMessage } from '@botornot/shared';

// A stand-in for Coinbase's embedded wallet SDK: one user whose wallet is a local key, so the
// signatures are real ones.
const account = privateKeyToAccount(generatePrivateKey());
const cdp = vi.hoisted(() => ({
  signedIn: false,
  initialize: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
}));
vi.mock('@coinbase/cdp-core', () => {
  const user = () => ({ userId: 'u1', evmAccountObjects: [{ address: account.address }] });
  return {
    initialize: cdp.initialize,
    isSignedIn: async () => cdp.signedIn,
    getCurrentUser: async () => (cdp.signedIn ? user() : null),
    signInWithEmail: async () => ({ flowId: 'flow-1', message: 'sent' }),
    verifyEmailOTP: async ({ otp }: { otp: string }) => {
      if (otp !== '123456') throw new Error('Invalid OTP');
      cdp.signedIn = true;
      return { user: user(), isNewUser: true, message: 'ok' };
    },
    signOut: async () => {
      await cdp.signOut();
      cdp.signedIn = false;
    },
    toViemAccount: (address: Address) => {
      if (address !== account.address) throw new Error('not authorized for this account');
      return account;
    },
  };
});

// The chain, as the page reads it: the vault's nonce for the player, and its message wording.
const chain = vi.hoisted(() => ({ nonce: 0n }));
vi.mock('viem', async (importOriginal) => ({
  ...(await importOriginal<typeof import('viem')>()),
  createPublicClient: () => ({
    readContract: async ({ functionName, args }: { functionName: string; args?: bigint[] }) => {
      if (functionName === 'nonces') return chain.nonce;
      if (functionName === 'withdrawAllMessage') return `Withdraw all. Nonce: ${args![0]}`;
      if (functionName === 'sessionMessage') return `Session ${args![0]} days. Nonce: ${args![1]}`;
      throw new Error(`unexpected read: ${functionName}`);
    },
  }),
}));

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => store.set(k, v),
  removeItem: (k: string) => store.delete(k),
});
vi.stubGlobal('window', { location: { origin: 'https://botornot.example', search: '' } });
vi.stubEnv('NEXT_PUBLIC_CDP_PROJECT_ID', 'test-project');

const embedded = await import('../lib/embedded');
const wallet = await import('../lib/wallet');

beforeEach(() => {
  chain.nonce = 0n;
  store.clear();
  cdp.signedIn = false;
  cdp.signOut.mockClear();
});

describe('email sign-in with an embedded wallet', () => {
  it('signs the game sign-in message with the new wallet and remembers it', async () => {
    const flow = await embedded.startEmail(' player@example.com ');
    const address = await embedded.finishEmail(flow, '123456');
    const signIn = await wallet.signInWithEmbedded(address);

    expect(signIn).toMatchObject({ address: account.address, kind: 'embedded' });
    const message = signInMessage({
      address: account.address,
      origin: 'https://botornot.example',
      chainId: baseSepolia.id,
      issuedAt: signIn.issuedAt,
    });
    // The same check the game server makes.
    expect(
      await verifyMessage({ address: account.address, message, signature: signIn.signature }),
    ).toBe(true);
    expect(wallet.savedSignIn()).toEqual(signIn);
    expect(wallet.lastWalletKind()).toBe('embedded');
    expect(cdp.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'test-project', ethereum: { createOnLogin: 'eoa' } }),
    );
  });

  it('rejects a wrong code', async () => {
    const flow = await embedded.startEmail('player@example.com');
    await expect(embedded.finishEmail(flow, '000000')).rejects.toThrow(/OTP/);
  });

  it("starts each sign-in signed out, so it can't reuse someone else's session", async () => {
    cdp.signedIn = true;
    await embedded.startEmail('someone-else@example.com');
    expect(cdp.signOut).toHaveBeenCalledOnce();
  });

  it('picks a returning player back up while Coinbase still has them signed in', async () => {
    cdp.signedIn = true;
    expect(await embedded.currentWallet()).toBe(account.address);
    cdp.signedIn = false;
    expect(await embedded.currentWallet()).toBeNull();
  });

  it('signs out of Coinbase too', async () => {
    const flow = await embedded.startEmail('player@example.com');
    await wallet.signInWithEmbedded(await embedded.finishEmail(flow, '123456'));
    cdp.signOut.mockClear();

    await wallet.signOut();

    expect(cdp.signOut).toHaveBeenCalledOnce();
    expect(wallet.savedSignIn()).toBeNull();
    expect(wallet.lastWalletKind()).toBeNull();
  });
});

describe('saved sign-ins', () => {
  it('treats one saved before embedded wallets as a Base Account', () => {
    store.set(
      'botornot.wallet',
      JSON.stringify({ address: account.address, issuedAt: Date.now(), signature: '0x' }),
    );
    expect(wallet.lastWalletKind()).toBe('base');
  });

  it("doesn't sign out of Coinbase for a Base Account", async () => {
    store.set(
      'botornot.wallet',
      JSON.stringify({ address: account.address, issuedAt: Date.now(), signature: '0x' }),
    );
    await wallet.signOut();
    expect(cdp.signOut).not.toHaveBeenCalled();
    expect(wallet.lastWalletKind()).toBeNull();
  });

  it('keeps the wallet kind after the day-long sign-in runs out', () => {
    store.set(
      'botornot.wallet',
      JSON.stringify({
        address: account.address,
        issuedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
        signature: '0x',
        kind: 'embedded',
      }),
    );
    expect(wallet.savedSignIn()).toBeNull();
    expect(wallet.lastWalletKind()).toBe('embedded');
  });
});

describe('signing for the vault', () => {
  const contracts = { token: account.address, vault: account.address };

  it("signs with the vault's current nonce, not one read before the last top-up", async () => {
    const flow = await embedded.startEmail('player@example.com');
    const player = await wallet.signInWithEmbedded(await embedded.finishEmail(flow, '123456'));

    const session = await wallet.signSession(contracts, player, 7);
    expect(
      await verifyMessage({
        address: account.address,
        message: 'Session 7 days. Nonce: 0',
        signature: session,
      }),
    ).toBe(true);

    chain.nonce = 1n; // the session used nonce 0
    const withdrawal = await wallet.signWithdrawAll(contracts, player);
    expect(
      await verifyMessage({
        address: account.address,
        message: 'Withdraw all. Nonce: 1',
        signature: withdrawal,
      }),
    ).toBe(true);
  });
});
