import { type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

/** The operator account signs commitment receipts (and, from M3, settlement transactions). */
export function operatorAccount(privateKey?: string) {
  const key = (privateKey as Hex | undefined) ?? generatePrivateKey();
  return privateKeyToAccount(key);
}
