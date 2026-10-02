/**
 * Catches the usual paymaster mix-up: a Coinbase paymaster URL for the wrong network (the portal
 * can show Base mainnet first). Players' wallets then refuse every batch with "Base Sepolia is not
 * supported", which says nothing about the URL. Returns what's wrong, or undefined when the URL
 * looks right or can't be checked from here.
 */
export async function paymasterProblem(
  url: string,
  chainId: number,
  fetchFn: typeof fetch = fetch,
): Promise<string | undefined> {
  const fix =
    'In the Coinbase portal, switch the Paymaster page to Base Sepolia, set it up there and copy ' +
    'its URL into PAYMASTER_URL.';
  try {
    // Coinbase paymaster URLs name their network: /rpc/v1/base-sepolia/<key>.
    const { hostname, pathname } = new URL(url);
    const network = pathname.match(/^\/rpc\/v1\/([^/]+)\//)?.[1];
    if (hostname === 'api.developer.coinbase.com' && network && !network.includes('sepolia')) {
      const name = network === 'base' ? 'Base mainnet' : network;
      return `PAYMASTER_URL is for ${name}, not Base Sepolia. ${fix}`;
    }
    // Any other paymaster: ask it which chain it serves.
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      signal: AbortSignal.timeout(5_000),
    });
    const { result } = (await res.json()) as { result?: unknown };
    if (typeof result === 'string' && /^0x[0-9a-f]+$/i.test(result)) {
      const served = Number(BigInt(result));
      if (served !== chainId) {
        const name = served === 8453 ? 'Base mainnet' : `chain ${served}`;
        return `PAYMASTER_URL is for ${name}, not Base Sepolia. ${fix}`;
      }
    }
  } catch {
    // unreachable or not JSON: the wallet will say if it's wrong
  }
  return undefined;
}
