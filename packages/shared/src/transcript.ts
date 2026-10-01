import { type Hex, encodeAbiParameters, keccak256, stringToHex } from 'viem';

/** Who sent a message, as recorded in the transcript hash chain. */
export const SENDER_TAG = { A: 0, B: 1, BOT: 2 } as const;
export type SenderTag = keyof typeof SENDER_TAG;

/** h0 = keccak256(roundId) */
export function transcriptGenesis(roundId: Hex): Hex {
  return keccak256(roundId);
}

/** h(n) = keccak256(abi.encode(h(n-1), senderTag, keccak256(text), at)) */
export function nextTranscriptHash(prev: Hex, sender: SenderTag, text: string, at: number): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'uint8' }, { type: 'bytes32' }, { type: 'uint64' }],
      [prev, SENDER_TAG[sender], keccak256(stringToHex(text)), BigInt(at)],
    ),
  );
}
