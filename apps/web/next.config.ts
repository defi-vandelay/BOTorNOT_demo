import type { NextConfig } from 'next';

const x402Stub = './lib/x402-stub.ts';

const config: NextConfig = {
  transpilePackages: ['@botornot/shared'],
  turbopack: {
    // Optional x402 imports deep inside Coinbase's SDKs; see lib/x402-stub.ts.
    resolveAlias: Object.fromEntries(
      [
        '@x402/core/client',
        '@x402/evm',
        '@x402/evm/exact/client',
        '@x402/evm/upto/client',
        '@x402/svm/exact/client',
        '@x402/svm/upto/client',
        'x402-fetch',
      ].map((name) => [name, x402Stub]),
    ),
  },
};

export default config;
