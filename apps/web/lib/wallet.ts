import { createPublicClient, createWalletClient, custom, http, type Address, type Hex } from 'viem';
import { baseSepolia } from 'viem/chains';
import { SIGN_IN_TTL_MS, gameTokenAbi, gameVaultAbi, signInMessage } from '@botornot/shared';
import { signAs, signOutEmbedded } from './embedded';

/**
 * Two kinds of wallet on Base Sepolia, both only ever asked to sign messages: one to sign in,
 * which the game server checks, and one each to start a session or withdraw, which the server
 * sends on-chain and pays for.
 * - "embedded": created for players who sign in with an email code or Google, Apple or X
 *   (see embedded.ts). Signs on this page, with no popup.
 * - "base": a Base Account (Coinbase's smart wallet: a passkey, nothing to install). Signs in
 *   Coinbase's popup. (It signs for Base Sepolia but won't send transactions there.)
 */
export type WalletKind = 'embedded' | 'base';

const STORAGE_KEY = 'botornot.wallet';
const UNIT = 10n ** 18n;
export const SESSION_DAYS = 7;

export interface WalletSignIn {
  address: Address;
  issuedAt: number;
  signature: Hex;
  /** Missing on sign-ins saved before embedded wallets, which were all Base Accounts. */
  kind?: WalletKind;
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

function saved(): WalletSignIn | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as WalletSignIn | null;
  } catch {
    return null; // nothing saved, or storage is unavailable
  }
}

/** A sign-in saved by this browser that the server will still accept. */
export function savedSignIn(): WalletSignIn | null {
  const signIn = saved();
  return signIn && Date.now() - signIn.issuedAt < SIGN_IN_TTL_MS - 60_000 ? signIn : null;
}

/** How this browser last signed in, even if that sign-in has since run out. */
export function lastWalletKind(): WalletKind | null {
  const signIn = saved();
  return signIn ? (signIn.kind ?? 'base') : null;
}

/** Signs `message` with the player's wallet, whichever kind it is. */
function signWith(who: Pick<WalletSignIn, 'address' | 'kind'>, message: string): Promise<Hex> {
  if (who.kind === 'embedded') return signAs(who.address, message);
  return walletClient().then((client) => client.signMessage({ account: who.address, message }));
}

/** Signs the game's sign-in message and remembers it for the next visit. */
async function completeSignIn(address: Address, kind: WalletKind): Promise<WalletSignIn> {
  const issuedAt = Date.now();
  const message = signInMessage({
    address,
    origin: window.location.origin,
    chainId: baseSepolia.id,
    issuedAt,
  });
  const result: WalletSignIn = {
    address,
    issuedAt,
    signature: await signWith({ address, kind }, message),
    kind,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
  } catch {
    // fine: they'll sign in again next visit
  }
  return result;
}

export async function signInWithBaseAccount(): Promise<WalletSignIn> {
  const client = await walletClient();
  const [address] = await client.requestAddresses();
  if (!address) throw new Error('No account selected');
  return completeSignIn(address, 'base');
}

/** For a player signed in with an email code or a social account (see embedded.ts). */
export function signInWithEmbedded(address: Address): Promise<WalletSignIn> {
  return completeSignIn(address, 'embedded');
}

export async function signOut(): Promise<void> {
  const kind = lastWalletKind();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to clear
  }
  if (kind === 'embedded') await signOutEmbedded();
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
  player: WalletSignIn,
  days: number,
  nonce: bigint,
): Promise<Hex> {
  const message = await publicClient.readContract({
    address: c.vault,
    abi: gameVaultAbi,
    functionName: 'sessionMessage',
    args: [BigInt(days), nonce],
  });
  return signWith(player, message);
}

/** Signs the vault's wording for withdrawing the whole balance (GameVault.withdrawAllMessage). */
export async function signWithdrawAll(
  c: Contracts,
  player: WalletSignIn,
  nonce: bigint,
): Promise<Hex> {
  const message = await publicClient.readContract({
    address: c.vault,
    abi: gameVaultAbi,
    functionName: 'withdrawAllMessage',
    args: [nonce],
  });
  return signWith(player, message);
}

/** Whole tokens for display. */
export function wholeTokens(amount: bigint): number {
  return Number(amount / UNIT);
}
