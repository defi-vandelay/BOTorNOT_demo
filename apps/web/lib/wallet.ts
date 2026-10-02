import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  http,
  maxUint256,
  type Address,
  type Hex,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { SIGN_IN_TTL_MS, gameTokenAbi, gameVaultAbi, signInMessage } from '@botornot/shared';

/**
 * Base Account (Coinbase's smart wallet: a passkey, nothing to install) on Base Sepolia.
 * The player signs in once with a message the game server checks; after that every transaction
 * is a batch of calls whose gas the paymaster sponsors.
 */

const STORAGE_KEY = 'botornot.wallet';
const UNIT = 10n ** 18n;
export const SESSION_DAYS = 7;

export interface WalletSignIn {
  address: Address;
  issuedAt: number;
  signature: Hex;
}

export interface WalletBalances {
  /** Test tokens in the wallet, not yet deposited. */
  wallet: bigint;
  /** When the token faucet can be used again (unix ms; 0 = now). */
  faucetReadyAt: number;
}

type Provider = Parameters<typeof custom>[0];
let provider: Provider | undefined;

/** Loaded on first use, in the browser only. */
async function walletClient() {
  if (!provider) {
    const { createBaseAccountSDK } = await import('@base-org/account');
    provider = createBaseAccountSDK({
      appName: 'BOT or NOT',
      appChainIds: [baseSepolia.id],
    }).getProvider() as Provider;
  }
  return createWalletClient({ chain: baseSepolia, transport: custom(provider) });
}

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL || undefined),
});

/** A sign-in saved by this browser that the server will still accept. */
export function savedSignIn(): WalletSignIn | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as WalletSignIn | null;
    if (saved && Date.now() - saved.issuedAt < SIGN_IN_TTL_MS - 60_000) return saved;
  } catch {
    // nothing saved, or storage is unavailable
  }
  return null;
}

export async function signIn(): Promise<WalletSignIn> {
  const client = await walletClient();
  const [address] = await client.requestAddresses();
  if (!address) throw new Error('No account selected');
  const issuedAt = Date.now();
  const message = signInMessage({
    address,
    origin: window.location.origin,
    chainId: baseSepolia.id,
    issuedAt,
  });
  const signature = await client.signMessage({ account: address, message });
  const result = { address, issuedAt, signature };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
  } catch {
    // fine: they'll sign in again next visit
  }
  return result;
}

export function signOut(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to clear
  }
}

export async function readBalances(token: Address, player: Address): Promise<WalletBalances> {
  const [wallet, lastClaim, cooldown] = await Promise.all([
    publicClient.readContract({
      address: token,
      abi: gameTokenAbi,
      functionName: 'balanceOf',
      args: [player],
    }),
    publicClient.readContract({
      address: token,
      abi: gameTokenAbi,
      functionName: 'lastClaim',
      args: [player],
    }),
    publicClient.readContract({
      address: token,
      abi: gameTokenAbi,
      functionName: 'FAUCET_COOLDOWN',
    }),
  ]);
  const readyAt = lastClaim === 0n ? 0 : Number(lastClaim + cooldown) * 1000;
  return { wallet, faucetReadyAt: readyAt };
}

export interface Contracts {
  token: Address;
  vault: Address;
}

type CallData = { to: Address; data: Hex };

/**
 * Everything needed to be ready to play, in one batch: claim free tokens if the faucet is ready,
 * deposit whatever is in the wallet, and (re)start a staking session.
 */
export function topUpCalls(
  c: Contracts,
  opts: { claimFaucet: boolean; walletTokens: bigint; startSession: boolean },
): CallData[] {
  const calls: CallData[] = [];
  const deposit = opts.walletTokens + (opts.claimFaucet ? 1_000n * UNIT : 0n);
  if (opts.claimFaucet) {
    calls.push({
      to: c.token,
      data: encodeFunctionData({ abi: gameTokenAbi, functionName: 'faucet' }),
    });
  }
  if (deposit > 0n) {
    calls.push(
      {
        to: c.token,
        data: encodeFunctionData({
          abi: gameTokenAbi,
          functionName: 'approve',
          args: [c.vault, maxUint256],
        }),
      },
      {
        to: c.vault,
        data: encodeFunctionData({ abi: gameVaultAbi, functionName: 'deposit', args: [deposit] }),
      },
    );
  }
  if (opts.startSession) {
    const expiry = BigInt(Math.floor(Date.now() / 1000) + SESSION_DAYS * 86_400);
    calls.push({
      to: c.vault,
      data: encodeFunctionData({
        abi: gameVaultAbi,
        functionName: 'startSession',
        args: [expiry],
      }),
    });
  }
  return calls;
}

export function withdrawCalls(c: Contracts, wholeTokens: number): CallData[] {
  return [
    {
      to: c.vault,
      data: encodeFunctionData({
        abi: gameVaultAbi,
        functionName: 'withdraw',
        args: [BigInt(wholeTokens) * UNIT],
      }),
    },
  ];
}

/** Sends a batch from the player's wallet and waits for it to land. */
export async function sendCalls(
  from: Address,
  calls: CallData[],
  paymasterUrl?: string,
): Promise<void> {
  const client = await walletClient();
  const { id } = await client.sendCalls({
    account: from,
    calls,
    forceAtomic: true,
    capabilities: paymasterUrl ? { paymasterService: { url: paymasterUrl } } : undefined,
  });
  const result = await client.waitForCallsStatus({ id, timeout: 120_000 });
  if (result.status !== 'success') throw new Error('The transaction did not go through');
}

/** Whole tokens for display. */
export function wholeTokens(amount: bigint): number {
  return Number(amount / UNIT);
}
