import { describe, expect, it } from 'vitest';
import { microUsdFor, priceFor, PRICE_TABLE_VERSION } from './prices.js';

describe('price table', () => {
  it('is versioned and prices the default model conservatively', () => {
    expect(PRICE_TABLE_VERSION).toBe('2026-10-15');
    const price = priceFor('vertex:gemini-2.5-flash');
    expect(price.inputMicroUsdPerToken).toBeGreaterThanOrEqual(1.5);
    expect(price.outputMicroUsdPerToken).toBeGreaterThanOrEqual(7.5);
  });
  it('carries the non-global standard price, the highest listed for Gemini 3.8 Flash', () => {
    expect(priceFor('vertex:gemini-3.8-flash')).toEqual({
      inputMicroUsdPerToken: 1.65,
      outputMicroUsdPerToken: 8.25,
    });
  });
  it('prices the default model with the 3.8 Flash upper bound', () => {
    expect(priceFor('vertex:gemini-2.5-flash')).toEqual(priceFor('vertex:gemini-3.8-flash'));
  });
  it('refuses a model without a price', () => {
    expect(() => priceFor('vertex:unknown-model')).toThrow(/price/i);
  });
  it('rounds money up to whole micro-USD', () => {
    const price = { inputMicroUsdPerToken: 1.5, outputMicroUsdPerToken: 7.5 };
    expect(microUsdFor(price, { inputTokens: 1, outputTokens: 1 })).toBe(9);
    expect(microUsdFor(price, { inputTokens: 1000, outputTokens: 100 })).toBe(2250);
    expect(microUsdFor(price, { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });
});
