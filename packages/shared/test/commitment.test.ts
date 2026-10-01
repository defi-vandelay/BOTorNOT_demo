import { describe, expect, it } from 'vitest';
import {
  botPartnerId,
  computeCommitment,
  humanPartnerId,
  nextTranscriptHash,
  randomBytes32,
  transcriptGenesis,
} from '../src';

const roundId = `0x${'11'.repeat(32)}` as const;
const judge = '0x00000000000000000000000000000000000000aa' as const;
const salt = `0x${'22'.repeat(32)}` as const;

describe('computeCommitment', () => {
  it('matches the vector checked in the Solidity tests', () => {
    // Same inputs are asserted in packages/contracts/test/Commitment.t.sol.
    const commit = computeCommitment({
      roundId,
      judge,
      partnerType: 'BOT',
      partnerId: botPartnerId('persona-001'),
      salt,
    });
    expect(commit).toMatchInlineSnapshot(
      `"0x23b15ac1eaf9a69f502d1f818f78fb8e25a18cf8d05bc0ffdacb308fff408dd1"`,
    );
  });

  it('differs between HUMAN and BOT answers', () => {
    const partnerId = humanPartnerId('0x00000000000000000000000000000000000000bb');
    const human = computeCommitment({ roundId, judge, partnerType: 'HUMAN', partnerId, salt });
    const bot = computeCommitment({ roundId, judge, partnerType: 'BOT', partnerId, salt });
    expect(human).not.toBe(bot);
  });

  it('changes with the salt', () => {
    const base = { roundId, judge, partnerType: 'BOT', partnerId: botPartnerId('x') } as const;
    expect(computeCommitment({ ...base, salt })).not.toBe(
      computeCommitment({ ...base, salt: randomBytes32() }),
    );
  });
});

describe('humanPartnerId', () => {
  it('left-pads the address to 32 bytes', () => {
    expect(humanPartnerId('0x00000000000000000000000000000000000000bb')).toBe(
      `0x${'0'.repeat(62)}bb`,
    );
  });
});

describe('transcript hash chain', () => {
  it('depends on message order', () => {
    const h0 = transcriptGenesis(roundId);
    const ab = nextTranscriptHash(nextTranscriptHash(h0, 'A', 'hi', 1), 'B', 'hey', 2);
    const ba = nextTranscriptHash(nextTranscriptHash(h0, 'B', 'hey', 2), 'A', 'hi', 1);
    expect(ab).not.toBe(ba);
  });
});
