import type { Address, Hex } from 'viem';

/**
 * Coinbase's embedded wallets (CDP): players sign in with an email code or Google, Apple or X,
 * and get a wallet created for them. Coinbase keeps its key in secure hardware, usable only by the
 * signed-in player, and it signs on this page (no popup). Plain wallets (EOAs), so their signatures are ordinary ones the game server and the
 * vault already check. Off unless NEXT_PUBLIC_CDP_PROJECT_ID is set; the CDP Portal must also
 * list this site's address under the project's allowed domains.
 */

const PROJECT_ID = process.env.NEXT_PUBLIC_CDP_PROJECT_ID;
export const embeddedEnabled = !!PROJECT_ID;

export type SocialProvider = 'google' | 'apple' | 'x';

type Cdp = typeof import('@coinbase/cdp-core');
let ready: Promise<Cdp> | undefined;

/** Loaded and started on first use, in the browser only. */
function cdp(): Promise<Cdp> {
  if (!PROJECT_ID) return Promise.reject(new Error('Email and social sign-in are not set up'));
  ready ??= import('@coinbase/cdp-core').then(async (core) => {
    // Also finishes a Google, Apple or X sign-in this page has just come back from.
    await core.initialize({
      projectId: PROJECT_ID,
      ethereum: { createOnLogin: 'eoa' },
      disableAnalytics: true, // no usage tracking sent to Coinbase beyond the sign-in itself
    });
    return core;
  });
  ready.catch(() => (ready = undefined)); // let a later attempt retry
  return ready;
}

/** Whether this page load is the return trip from Google, Apple or X. */
export function returningFromSocial(): boolean {
  if (!embeddedEnabled) return false;
  const params = new URLSearchParams(window.location.search);
  return params.has('provider_type') && (params.has('flow_id') || params.has('error'));
}

/** Emails a 6-digit code; pass the returned flow to finishEmail. */
export async function startEmail(email: string): Promise<string> {
  const core = await fresh();
  const { flowId } = await core.signInWithEmail({ email: email.trim() });
  return flowId;
}

export async function finishEmail(flowId: string, code: string): Promise<Address> {
  const core = await cdp();
  const { user } = await core.verifyEmailOTP({ flowId, otp: code.trim() });
  return walletOf(user);
}

/** Leaves for the provider's sign-in page; it sends the player back to this page afterwards. */
export async function startSocial(provider: SocialProvider): Promise<void> {
  const core = await fresh();
  await core.signInWithOAuth(provider);
}

/** The signed-in player's wallet, if they're still signed in with Coinbase (or just came back). */
export async function currentWallet(): Promise<Address | null> {
  const core = await cdp();
  if (!(await core.isSignedIn())) return null;
  const user = await core.getCurrentUser();
  return user ? walletOf(user) : null;
}

export async function signAs(address: Address, message: string): Promise<Hex> {
  const core = await cdp();
  if (!(await core.isSignedIn())) {
    throw new Error('Your sign-in has run out. Sign out, then sign in again.');
  }
  return core.toViemAccount(address).signMessage({ message });
}

export async function signOutEmbedded(): Promise<void> {
  const core = await cdp();
  if (await core.isSignedIn()) await core.signOut();
}

/** The SDK with nobody signed in, so a new sign-in can't pick up someone else's session. */
async function fresh(): Promise<Cdp> {
  await signOutEmbedded();
  return cdp();
}

function walletOf(user: { evmAccountObjects?: { address: string }[]; evmAccounts?: string[] }) {
  const address = user.evmAccountObjects?.[0]?.address ?? user.evmAccounts?.[0];
  if (!address) throw new Error('Coinbase signed you in but did not create a wallet, try again');
  return address as Address;
}
