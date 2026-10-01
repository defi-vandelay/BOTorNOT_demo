import { describe, expect, it } from 'vitest';
import { recoverTypedDataAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  STAKE_UNITS,
  botPartnerId,
  commitmentReceiptTypes,
  computeCommitment,
  randomBytes32,
} from '@botornot/shared';
import { CommitService } from '../src/game/commit';

describe('CommitService', () => {
  it('signs a receipt that recovers to the operator', async () => {
    const operator = privateKeyToAccount(`0x${'02'.repeat(32)}`);
    const service = new CommitService(
      operator,
      84532,
      '0x0000000000000000000000000000000000000000',
    );
    const roundId = randomBytes32();
    const judge = '0x00000000000000000000000000000000000000aa';
    const partnerId = botPartnerId('persona-001');
    const issued = await service.issue({ roundId, judge, partnerType: 'BOT', partnerId });

    expect(issued.commit).toBe(
      computeCommitment({ roundId, judge, partnerType: 'BOT', partnerId, salt: issued.salt }),
    );
    const signer = await recoverTypedDataAddress({
      domain: service.domain,
      types: commitmentReceiptTypes,
      primaryType: 'Commitment',
      message: {
        roundId,
        judge,
        commit: issued.commit,
        stake: STAKE_UNITS,
        issuedAt: BigInt(issued.receipt.issuedAt),
      },
      signature: issued.receipt.signature,
    });
    expect(signer).toBe(operator.address);
  });
});
