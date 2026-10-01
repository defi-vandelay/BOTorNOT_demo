import {
  type Address,
  type Hex,
  bytesToHex,
  encodeAbiParameters,
  keccak256,
  pad,
  stringToHex,
} from 'viem';
import { PARTNER_TYPE, type PartnerType } from './constants';

export interface CommitmentInput {
  roundId: Hex;
  judge: Address;
  partnerType: PartnerType;
  partnerId: Hex;
  salt: Hex;
}

/**
 * commit = keccak256(abi.encode(roundId, judge, partnerType, partnerId, salt))
 * Must match GameVault's on-chain computation byte for byte.
 */
export function computeCommitment(input: CommitmentInput): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'address' },
        { type: 'uint8' },
        { type: 'bytes32' },
        { type: 'bytes32' },
      ],
      [input.roundId, input.judge, PARTNER_TYPE[input.partnerType], input.partnerId, input.salt],
    ),
  );
}

/** partnerId for a human partner: their address, left-padded to 32 bytes. */
export function humanPartnerId(address: Address): Hex {
  return pad(address, { size: 32 });
}

/** partnerId for a bot partner: keccak256 of the persona id. */
export function botPartnerId(personaId: string): Hex {
  return keccak256(stringToHex(personaId));
}

/** 32 cryptographically random bytes, for salts and round ids. */
export function randomBytes32(): Hex {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

/** EIP-712 types for the operator's commitment receipt. */
export const commitmentReceiptTypes = {
  Commitment: [
    { name: 'roundId', type: 'bytes32' },
    { name: 'judge', type: 'address' },
    { name: 'commit', type: 'bytes32' },
    { name: 'stake', type: 'uint256' },
    { name: 'issuedAt', type: 'uint64' },
  ],
} as const;

export function eip712Domain(chainId: number, verifyingContract: Address) {
  return { name: 'BOTorNOT', version: '1', chainId, verifyingContract } as const;
}
