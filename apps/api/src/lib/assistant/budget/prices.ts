import { AppError } from '../../errors.js';

/**
 * Prices for the deployment models only, in micro-USD per token, as conservative upper
 * bounds. Source: Google Cloud Vertex AI generative AI pricing
 * (cloud.google.com/vertex-ai/generative-ai/pricing), read 2026-10-15. Gemini 3.8 Flash,
 * per 1M tokens, the same above and below 200K input tokens:
 *   - through 2026-12-31 (introductory): global 0.75 in / 3.75 out; non-global 0.825 / 4.125
 *   - from 2027-01-01 (standard): global 1.50 in / 7.50 out; non-global 1.65 / 8.25
 * The deployment calls a regional endpoint (ASSISTANT_VERTEX_LOCATION, europe-west1 by
 * default), which is non-global, so the table carries the highest row, the non-global
 * standard price, and a reservation can only overshoot. A user's own key is never priced
 * here; it counts tokens only.
 */
export const PRICE_TABLE_VERSION = '2026-10-15';

export interface ModelPrice {
  inputMicroUsdPerToken: number;
  outputMicroUsdPerToken: number;
}

const PRICES: Record<string, ModelPrice> = {
  'vertex:gemini-3.8-flash': { inputMicroUsdPerToken: 1.65, outputMicroUsdPerToken: 8.25 },
  // The default model. A deliberate upper bound carried over from the 3.8 Flash row above,
  // not a quote of Gemini 2.5 Flash's list price, which is lower.
  'vertex:gemini-2.5-flash': { inputMicroUsdPerToken: 1.65, outputMicroUsdPerToken: 8.25 },
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
