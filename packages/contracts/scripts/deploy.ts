/**
 * Deploys GameToken and GameVault to Base Sepolia with the operator key from apps/server/.env,
 * then writes GAME_VAULT_ADDRESS back into that file. Run from the repo root:
 *
 *   pnpm deploy:testnet
 *
 * Testnet only: it refuses any chain other than Base Sepolia.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, formatEther, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { EPOCH_MS, STAKE_UNITS } from '@botornot/shared';
import { compile } from './compile';

const envFile = join(dirname(fileURLToPath(import.meta.url)), '../../../apps/server/.env');

function readEnv(): Record<string, string> {
  if (!existsSync(envFile)) return {};
  const env: Record<string, string> = {};
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && m[2]) env[m[1]!] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

/** Sets KEY=value in apps/server/.env, replacing an existing line or appending one. */
function writeEnv(key: string, value: string): void {
  const text = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
  writeFileSync(
    envFile,
    pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`,
  );
}

function fail(msg: string): never {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

async function main() {
  const env = readEnv();
  const key = env.OPERATOR_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    fail('No OPERATOR_PRIVATE_KEY in apps/server/.env. See step 3 of the M3 setup guide.');
  }
  const chainId = Number(env.CHAIN_ID ?? baseSepolia.id);
  if (chainId !== baseSepolia.id)
    fail(`CHAIN_ID is ${chainId}; this script only deploys to Base Sepolia (84532).`);
  const rpc = env.RPC_URL ?? baseSepolia.rpcUrls.default.http[0];
  const epochSeconds = BigInt(Math.round(Number(env.EPOCH_MS ?? EPOCH_MS) / 1000));

  const account = privateKeyToAccount(key as Hex);
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(rpc) });

  const eth = await publicClient.getBalance({ address: account.address });
  console.log(`Operator ${account.address}: ${formatEther(eth)} ETH on Base Sepolia`);
  if (eth === 0n) {
    fail(
      'The operator has no test ETH. Claim some from the faucet (step 4 of the setup guide), then run this again.',
    );
  }

  console.log('Compiling contracts…');
  const { GameToken, GameVault } = compile();

  console.log('Deploying GameToken…');
  const tokenTx = await wallet.deployContract({ abi: GameToken.abi, bytecode: GameToken.bytecode });
  const token = (await publicClient.waitForTransactionReceipt({ hash: tokenTx })).contractAddress!;

  console.log(
    `Deploying GameVault (stake ${formatEther(STAKE_UNITS)} tBON, ${epochSeconds}s pools)…`,
  );
  const vaultTx = await wallet.deployContract({
    abi: GameVault.abi,
    bytecode: GameVault.bytecode,
    args: [token, STAKE_UNITS, epochSeconds, account.address, account.address],
  });
  const vault = (await publicClient.waitForTransactionReceipt({ hash: vaultTx })).contractAddress!;

  writeEnv('GAME_VAULT_ADDRESS', vault);
  const scan = 'https://sepolia.basescan.org/address';
  console.log(`
Done. GAME_VAULT_ADDRESS has been saved to apps/server/.env.

  GameToken  ${token}
             ${scan}/${token}
  GameVault  ${vault}
             ${scan}/${vault}

Last step: in the Coinbase portal, open Onchain Tools > Paymaster > Configuration (Base Sepolia)
and add both addresses to the contract allowlist, so players' gas is sponsored:

  ${token}   functions: faucet, approve
  ${vault}   functions: deposit, withdraw, startSession, endSession

Then restart the game (pnpm dev).`);
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
