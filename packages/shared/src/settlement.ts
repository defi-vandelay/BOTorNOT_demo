import { DECEPTION_BPS, FEE_BPS, STAKE_POINTS, type PartnerType } from './constants';

/**
 * Payout pool settlement (plan doc 06 v2). Every staked call in an epoch settles in one pool, the
 * same way whether the partner was a human or a bot, so the best call is always the honest one.
 *
 * - A wrong call forfeits the stake. Each forfeit splits into the fee, a deception share and a
 *   share for right callers.
 * - The deception share goes to the human partner who fooled the caller if that partner called
 *   right too; otherwise (bot partner, or the partner got it wrong as well) to the daily pool.
 * - If both humans in a round are wrong, both forfeits (less the fee) go to the daily pool.
 * - A right call gets the stake back plus an equal share of what right callers are owed.
 *
 * Amounts are integer points; rounding dust goes to the daily pool so nothing is created or lost.
 */

export interface EpochCall {
  /** Address of the caller (any consistent form; it is used as a key). */
  player: string;
  partnerType: PartnerType;
  correct: boolean;
  /** Human rounds only: the partner and whether they called right (null = no call). */
  partner?: { player: string; correct: boolean | null };
}

export interface PlayerSettlement {
  right: number;
  wrong: number;
  /** Paid back to the player: stakes on right calls, their pool share and deception shares. */
  credited: number;
  /** Deception shares earned this epoch (included in credited). */
  deception: number;
  /** credited minus every stake this player put in this epoch. */
  net: number;
}

export interface EpochSettlement {
  stake: number;
  rightCalls: number;
  wrongCalls: number;
  /** Profit on each right call, on top of the stake coming back. */
  profitPerRight: number;
  fee: number;
  deceptionPaid: number;
  toDailyPool: number;
  players: Record<string, PlayerSettlement>;
}

export interface SettlementRules {
  stake: number;
  feeBps: number;
  deceptionBps: number;
}

export const DEFAULT_RULES: SettlementRules = {
  stake: STAKE_POINTS,
  feeBps: FEE_BPS,
  deceptionBps: DECEPTION_BPS,
};

export function settleEpoch(
  calls: EpochCall[],
  rules: SettlementRules = DEFAULT_RULES,
): EpochSettlement {
  const { stake } = rules;
  const feeEach = Math.floor((stake * rules.feeBps) / 10_000);
  const deceptionEach = Math.floor((stake * rules.deceptionBps) / 10_000);
  const forRightEach = stake - feeEach - deceptionEach;

  const players: Record<string, PlayerSettlement> = {};
  const account = (player: string) =>
    (players[player] ??= { right: 0, wrong: 0, credited: 0, deception: 0, net: 0 });

  let fee = 0;
  let deceptionPaid = 0;
  let toDailyPool = 0;
  let forRight = 0;
  const rightCallers: string[] = [];

  for (const call of calls) {
    const me = account(call.player);
    me.net -= stake;
    if (call.correct) {
      me.right++;
      rightCallers.push(call.player);
      continue;
    }
    me.wrong++;
    fee += feeEach;
    if (call.partner && call.partner.correct === false) {
      // Both humans fooled each other: the whole forfeit, less the fee, feeds the daily pool.
      toDailyPool += stake - feeEach;
      continue;
    }
    if (call.partner?.correct) {
      const deceiver = account(call.partner.player);
      deceiver.deception += deceptionEach;
      deceiver.credited += deceptionEach;
      deceptionPaid += deceptionEach;
    } else {
      toDailyPool += deceptionEach;
    }
    forRight += forRightEach;
  }

  let profitPerRight = 0;
  if (rightCallers.length === 0) {
    toDailyPool += forRight;
  } else {
    profitPerRight = Math.floor(forRight / rightCallers.length);
    toDailyPool += forRight - profitPerRight * rightCallers.length;
    for (const player of rightCallers) account(player).credited += stake + profitPerRight;
  }

  for (const p of Object.values(players)) p.net += p.credited;

  return {
    stake,
    rightCalls: rightCallers.length,
    wrongCalls: calls.length - rightCallers.length,
    profitPerRight,
    fee,
    deceptionPaid,
    toDailyPool,
    players,
  };
}
