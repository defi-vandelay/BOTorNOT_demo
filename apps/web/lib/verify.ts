import { recoverTypedDataAddress, type Address } from 'viem';
import {
  STAKE_UNITS,
  commitmentReceiptTypes,
  computeCommitment,
  eip712Domain,
  type CommitmentReceipt,
} from '@botornot/shared';
import type { RoundResult, Welcome } from './game';

export interface Verification {
  /** The revealed answer and salt hash to the commitment received before the chat. */
  commitMatches: boolean;
  /** The receipt was signed by the operator key the server announced. */
  signedByOperator: boolean;
}

/** Re-checks the round's fairness in the browser, with no trust in the server's say-so. */
export async function verifyRound(args: {
  welcome: Welcome;
  judge: Address;
  roundId: `0x${string}`;
  receipt: CommitmentReceipt;
  result: RoundResult;
}): Promise<Verification> {
  const { welcome, judge, roundId, receipt, result } = args;
  const commit = computeCommitment({
    roundId,
    judge,
    partnerType: result.answer,
    partnerId: result.partnerId,
    salt: result.salt,
  });
  let signer: Address | null;
  try {
    signer = await recoverTypedDataAddress({
      domain: eip712Domain(welcome.chainId, welcome.verifyingContract),
      types: commitmentReceiptTypes,
      primaryType: 'Commitment',
      message: {
        roundId,
        judge,
        commit: receipt.commit,
        stake: STAKE_UNITS,
        issuedAt: BigInt(receipt.issuedAt),
      },
      signature: receipt.signature,
    });
  } catch {
    signer = null;
  }
  return {
    commitMatches: commit === receipt.commit,
    signedByOperator: signer?.toLowerCase() === welcome.operator.toLowerCase(),
  };
}
