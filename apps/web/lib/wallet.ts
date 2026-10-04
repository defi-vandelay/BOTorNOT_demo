import { createPublicClient, createWalletClient, custom, http, type Address, type Hex } from 'viem';
import { baseSepolia } from 'viem/chains';
import { SIGN_IN_TTL_MS, gameTokenAbi, gameVaultAbi, signInMessage } from '@botornot/shared';

/**
 * Base Account (Coinbase's smart wallet: a passkey, nothing to install) on Base Sepolia.
 * The wallet is only ever asked to sign messages: one to sign in, which the game server checks,
 * and one each to start a session or withdraw, which the server sends on-chain and pays for.
 * (The wallet signs for Base Sepolia but won't send transactions there.)
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
  /** Test tokens in the wallet itself (withdrawn from the game). */
  wallet: bigint;
  /** When the token faucet can be used again (unix ms; 0 = now). */
  faucetReadyAt: number;
  /** The vault's nonce for the player's next signed message. */
  nonce: bigint;
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

export interface Contracts {
  token: Address;
  vault: Address;
}

export async function readBalances(c: Contracts, player: Address): Promise<WalletBalances> {
  const { token, vault } = c;
  const [wallet, lastClaim, cooldown, nonce] = await Promise.all([
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
    publicClient.readContract({
      address: vault,
      abi: gameVaultAbi,
      functionName: 'nonces',
      args: [player],
    }),
  ]);
  const readyAt = lastClaim === 0n ? 0 : Number(lastClaim + cooldown) * 1000;
  return { wallet, faucetReadyAt: readyAt, nonce };
}

/** Signs the vault's own wording for a session of `days` days (GameVault.sessionMessage). */
export async function signSession(
  c: Contracts,
  player: Address,
  days: number,
  nonce: bigint,
): Promise<Hex> {
  const message = await publicClient.readContract({
    address: c.vault,
    abi: gameVaultAbi,
    functionName: 'sessionMessage',
    args: [BigInt(days), nonce],
  });
  return (await walletClient()).signMessage({ account: player, message });
}

/** Signs the vault's wording for withdrawing the whole balance (GameVault.withdrawAllMessage). */
export async function signWithdrawAll(c: Contracts, player: Address, nonce: bigint): Promise<Hex> {
  const message = await publicClient.readContract({
    address: c.vault,
    abi: gameVaultAbi,
    functionName: 'withdrawAllMessage',
    args: [nonce],
  });
  return (await walletClient()).signMessage({ account: player, message });
}

/** Whole tokens for display. */
export function wholeTokens(amount: bigint): number {
  return Number(amount / UNIT);
}
