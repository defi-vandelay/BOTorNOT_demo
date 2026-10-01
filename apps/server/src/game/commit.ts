import type { Address, Hex, LocalAccount } from 'viem';
import {
  STAKE_UNITS,
  commitmentReceiptTypes,
  computeCommitment,
  eip712Domain,
  randomBytes32,
  type CommitmentInput,
  type CommitmentReceipt,
} from '@botornot/shared';

export interface IssuedCommitment {
  salt: Hex;
  commit: Hex;
  receipt: CommitmentReceipt;
}

/**
 * Fixes each judge's answer before the chat starts: a fresh salt, the commitment hash, and an
 * EIP-712 receipt signed by the operator that the player keeps as proof.
 */
export class CommitService {
  constructor(
    private readonly operator: LocalAccount,
    private readonly chainId: number,
    private readonly verifyingContract: Address,
  ) {}

  get operatorAddress(): Address {
    return this.operator.address;
  }

  get domain() {
    return eip712Domain(this.chainId, this.verifyingContract);
  }

  async issue(input: Omit<CommitmentInput, 'salt'>): Promise<IssuedCommitment> {
    const salt = randomBytes32();
    const commit = computeCommitment({ ...input, salt });
    const issuedAt = Math.floor(Date.now() / 1000);
    const signature = await this.operator.signTypedData({
      domain: this.domain,
      types: commitmentReceiptTypes,
      primaryType: 'Commitment',
      message: {
        roundId: input.roundId,
        judge: input.judge,
        commit,
        stake: STAKE_UNITS,
        issuedAt: BigInt(issuedAt),
      },
    });
    return { salt, commit, receipt: { commit, issuedAt, signature } };
  }
}
