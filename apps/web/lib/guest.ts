import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

const KEY = 'botornot.guestKey';

/**
 * Until wallets arrive (M3), each browser gets a throwaway key; its address is the judge
 * address in commitments. Falls back to a per-visit key if storage is unavailable.
 */
export function guestAccount() {
  let key: Hex | null;
  try {
    key = localStorage.getItem(KEY) as Hex | null;
    if (!key) {
      key = generatePrivateKey();
      localStorage.setItem(KEY, key);
    }
  } catch {
    key = generatePrivateKey();
  }
  return privateKeyToAccount(key);
}
