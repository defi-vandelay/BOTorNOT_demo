import { describe, expect, it, vi } from 'vitest';
import { paymasterProblem } from '../src/chain/paymaster';

const answers = (result: unknown) =>
  vi.fn(async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result })));

describe('paymasterProblem', () => {
  it('spots a Coinbase paymaster URL for Base mainnet without calling it', async () => {
    const fetchFn = answers('0x2105');
    const problem = await paymasterProblem(
      'https://api.developer.coinbase.com/rpc/v1/base/abc123',
      84532,
      fetchFn,
    );
    expect(problem).toMatch(/for Base mainnet, not Base Sepolia/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('accepts the Base Sepolia one when it serves Base Sepolia', async () => {
    const fetchFn = answers('0x14a34');
    const url = 'https://api.developer.coinbase.com/rpc/v1/base-sepolia/abc123';
    expect(await paymasterProblem(url, 84532, fetchFn)).toBeUndefined();
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('asks other paymasters which chain they serve', async () => {
    expect(
      await paymasterProblem('https://paymaster.example/rpc', 84532, answers('0x2105')),
    ).toMatch(/for Base mainnet/);
    expect(await paymasterProblem('https://paymaster.example/rpc', 84532, answers('0xa'))).toMatch(
      /for chain 10/,
    );
  });

  it("stays quiet when it can't tell", async () => {
    const down = vi.fn(async () => {
      throw new Error('offline');
    });
    const refuses = vi.fn(
      async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601 } })),
    );
    expect(await paymasterProblem('https://paymaster.example/rpc', 84532, down)).toBeUndefined();
    expect(await paymasterProblem('https://paymaster.example/rpc', 84532, refuses)).toBeUndefined();
  });
});
