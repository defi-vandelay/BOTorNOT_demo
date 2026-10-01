import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';

const KEY = 'botornot.guestKey';

/**
 * Until wallets arrive (M3), each browser tab gets a throwaway key; its address is the judge
 * address in commitments. Per tab (sessionStorage) so two windows can play each other in dev.
 */
export function guestAccount() {
  let key: Hex | null;
  try {
    key = sessionStorage.getItem(KEY) as Hex | null;
    if (!key) {
      key = generatePrivateKey();
      sessionStorage.setItem(KEY, key);
    }
  } catch {
    key = generatePrivateKey();
  }
  return privateKeyToAccount(key);
}
