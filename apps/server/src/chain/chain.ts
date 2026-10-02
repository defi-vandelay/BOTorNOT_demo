import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  http,
  type Address,
  type Chain as ViemChain,
  type Hex,
  type LocalAccount,
  type PublicClient,
  type Transport,
  type WalletClient,
} from 'viem';
import { baseSepolia } from 'viem/chains';
import { gameVaultAbi } from '@botornot/shared';

/** One judge's reveal and call, as GameVault.settleRound takes it. */
export interface ChainJudge {
  player: Address;
  partnerType: 0 | 1;
  partnerId: Hex;
  salt: Hex;
  /** 0 = NOT (human), 1 = BOT, 255 = no call. */
  call: number;
}

export const NO_CALL = 255;

export interface SettledCall {
  player: Address;
  epoch: number;
  staked: boolean;
}

export interface EpochResult {
  rightCalls: number;
  wrongCalls: number;
  profitPerRight: bigint;
  closed: boolean;
}

export interface PlayerEpochResult {
  right: number;
  wrong: number;
  deception: bigint;
}

/**
 * The game's view of Base Sepolia: reads from GameVault, and sends the operator's transactions
 * one at a time (so nonces never clash) through a single queue.
 */
export class Chain {
  readonly public: PublicClient;
  private readonly wallet: WalletClient<Transport, ViemChain, LocalAccount>;
  private queue: Promise<unknown> = Promise.resolve();
  token: Address = '0x0000000000000000000000000000000000000000';
  genesis = 0;
  epochLength = 0;

  constructor(
    readonly vault: Address,
    operator: LocalAccount,
    rpcUrl: string,
    chain: ViemChain = baseSepolia,
  ) {
    this.public = createPublicClient({ chain, transport: http(rpcUrl) }) as PublicClient;
    this.wallet = createWalletClient({ account: operator, chain, transport: http(rpcUrl) });
  }

  get explorer(): string {
    return this.wallet.chain.blockExplorers?.default.url ?? 'https://sepolia.basescan.org';
  }

  /** Reads the vault's fixed settings; call once before anything else. */
  async init(): Promise<void> {
    const read = (functionName: 'token' | 'genesis' | 'epochLength' | 'operator') =>
      this.public.readContract({ address: this.vault, abi: gameVaultAbi, functionName });
    const [token, genesis, epochLength, operator] = await Promise.all([
      read('token'),
      read('genesis'),
      read('epochLength'),
      read('operator'),
    ]);
    if ((operator as Address).toLowerCase() !== this.wallet.account.address.toLowerCase()) {
      throw new Error(
        `GameVault's operator is ${operator}, but OPERATOR_PRIVATE_KEY is ${this.wallet.account.address}`,
      );
    }
    this.token = token as Address;
    this.genesis = Number(genesis);
    this.epochLength = Number(epochLength);
  }

  epochAt(ms: number): number {
    return Math.floor((ms / 1000 - this.genesis) / this.epochLength);
  }

  epochEndsAt(epoch: number): number {
    return (this.genesis + (epoch + 1) * this.epochLength) * 1000;
  }

  /** The latest block's timestamp, in ms. */
  async blockTime(): Promise<number> {
    return Number((await this.public.getBlock()).timestamp) * 1000;
  }

  async balanceOf(player: Address): Promise<bigint> {
    return this.public.readContract({
      address: this.vault,
      abi: gameVaultAbi,
      functionName: 'balanceOf',
      args: [player],
    });
  }

  /** Unix ms until which the operator may stake for this player (0 = no session). */
  async sessionExpiry(player: Address): Promise<number> {
    const s = await this.public.readContract({
      address: this.vault,
      abi: gameVaultAbi,
      functionName: 'sessionExpiry',
      args: [player],
    });
    return Number(s) * 1000;
  }

  async dailyPool(): Promise<bigint> {
    return this.public.readContract({
      address: this.vault,
      abi: gameVaultAbi,
      functionName: 'dailyPool',
    });
  }

  async epoch(epoch: number): Promise<EpochResult> {
    const [rightCalls, wrongCalls, , profitPerRight, closed] = await this.public.readContract({
      address: this.vault,
      abi: gameVaultAbi,
      functionName: 'epochs',
      args: [BigInt(epoch)],
    });
    return { rightCalls, wrongCalls, profitPerRight, closed };
  }

  async playerEpoch(epoch: number, player: Address): Promise<PlayerEpochResult> {
    const [right, wrong, deception] = await this.public.readContract({
      address: this.vault,
      abi: gameVaultAbi,
      functionName: 'playerEpochs',
      args: [BigInt(epoch), player],
    });
    return { right, wrong, deception };
  }

  async verifySignIn(address: Address, message: string, signature: Hex): Promise<boolean> {
    try {
      // Handles smart wallets too, deployed (ERC-1271) or not yet (ERC-6492).
      return await this.public.verifyMessage({ address, message, signature });
    } catch {
      return false;
    }
  }

  async settleRound(
    roundId: Hex,
    transcriptHash: Hex,
    judges: ChainJudge[],
  ): Promise<{ txHash: Hex; calls: SettledCall[] }> {
    return this.send(async () => {
      const txHash = await this.wallet.writeContract({
        address: this.vault,
        abi: gameVaultAbi,
        functionName: 'settleRound',
        args: [roundId, transcriptHash, judges],
      });
      const receipt = await this.public.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== 'success') throw new Error(`settleRound reverted (${txHash})`);
      const calls: SettledCall[] = [];
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== this.vault.toLowerCase()) continue;
        try {
          const ev = decodeEventLog({ abi: gameVaultAbi, data: log.data, topics: log.topics });
          if (ev.eventName === 'RoundSettled') {
            calls.push({
              player: ev.args.judge,
              epoch: Number(ev.args.epoch),
              staked: ev.args.staked,
            });
          }
        } catch {
          // not one of ours
        }
      }
      return { txHash, calls };
    });
  }

  /** Closes the epoch if nobody has yet, then pays its right callers. */
  async closeAndClaim(epoch: number, players: Address[]): Promise<Hex> {
    return this.send(async () => {
      const state = await this.epoch(epoch);
      if (!state.closed) {
        const close = await this.wallet.writeContract({
          address: this.vault,
          abi: gameVaultAbi,
          functionName: 'closeEpoch',
          args: [BigInt(epoch)],
        });
        await this.public.waitForTransactionReceipt({ hash: close });
      }
      const txHash = await this.wallet.writeContract({
        address: this.vault,
        abi: gameVaultAbi,
        functionName: 'claim',
        args: [BigInt(epoch), players],
      });
      const receipt = await this.public.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== 'success') throw new Error(`claim reverted (${txHash})`);
      return txHash;
    });
  }

  private send<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
