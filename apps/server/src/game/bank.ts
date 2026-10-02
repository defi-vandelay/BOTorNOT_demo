import type { Hex } from 'viem';
import type { EpochCall } from '@botornot/shared';
import type { ChainJudge } from '../chain/chain';

/** A finished round's staked calls, for on-chain settlement. */
export interface RoundSettlement {
  roundId: Hex;
  transcriptHash: Hex;
  judges: ChainJudge[];
  /** Called once per judge when the settle transaction is mined. */
  onSettled: (player: string, txHash: Hex) => void;
}

/**
 * Where stakes live: the off-chain points Ledger, or OnchainBank (test tokens in GameVault).
 * Amounts are whole points or whole tokens.
 */
export interface Bank {
  readonly epochEndsAt: number;
  balance(player: string): number;
  canStake(player: string): boolean;
  /** Takes one stake; returns false if the player can't cover it. */
  stake(player: string): boolean;
  refund(player: string): void;
  /** A staked call made this epoch. */
  record(call: EpochCall): void;
  /** On-chain only: when the player's staking session ends (unix ms; 0 = none). */
  sessionEndsAt?(player: string): number;
  /** On-chain only: settle a finished round's staked calls in GameVault. */
  settleRound?(round: RoundSettlement): void;
}
