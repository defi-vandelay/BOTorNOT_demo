/**
 * The Base Account SDK pulls in Coinbase's server SDK, which optionally supports x402 payments.
 * We don't use them, and the optional @x402 packages aren't installed, so next.config.ts points
 * those imports here. Anything that actually tries to use them fails loudly.
 */
function unavailable(): never {
  throw new Error('x402 payments are not available in this app');
}

export class x402Client {
  constructor() {
    unavailable();
  }
}
export const ExactEvmScheme = x402Client;
export const UptoEvmScheme = x402Client;
export const ExactSvmScheme = x402Client;
export const UptoSvmScheme = x402Client;
export const toClientEvmSigner = unavailable;
