import { AppError } from '../../errors.js';

/**
 * Prices for the deployment models only, in micro-USD per token, as conservative upper
 * bounds. Source: Google Cloud Vertex AI pricing, read 2026-10-15. Gemini 3.8 Flash is
 * listed at an introductory 0.75 USD input / 3.75 USD output per million tokens until
 * 2026-12-31, doubling on 2027-01-01; regional endpoints cost more than the global one.
 * The table carries the higher figures so a reservation can only overshoot. A user's own
 * key is never priced here; it counts tokens only.
 */
export const PRICE_TABLE_VERSION = '2026-10-15';

export interface ModelPrice {
  inputMicroUsdPerToken: number;
  outputMicroUsdPerToken: number;
}

const PRICES: Record<string, ModelPrice> = {
  'vertex:gemini-3.8-flash': { inputMicroUsdPerToken: 1.5, outputMicroUsdPerToken: 7.5 },
};

export function priceFor(modelRef: string): ModelPrice {
  const price = PRICES[modelRef];
  if (!price)
    throw new AppError(
      500,
      'ASSISTANT_PRICE_MISSING',
      `No price for ${modelRef} in price table ${PRICE_TABLE_VERSION}`,
    );
  return price;
}

/** Whole micro-USD, rounded up, so money is never under-reserved. */
export function microUsdFor(
  price: ModelPrice,
  tokens: { inputTokens: number; outputTokens: number },
): number {
  return Math.ceil(
    tokens.inputTokens * price.inputMicroUsdPerToken +
      tokens.outputTokens * price.outputMicroUsdPerToken,
  );
}
