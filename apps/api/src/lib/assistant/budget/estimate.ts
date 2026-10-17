/**
 * A margin under Google's documented average for Gemini models, about 4 characters per token
 * (ai.google.dev/gemini-api/docs/tokens, which gives English only). This is an assumption,
 * not a bound: no tokenizer is available here to measure German, and text dense in emoji or
 * rare scripts can yield more tokens per character. JSON escaping adds characters, which
 * widens the margin. Settlement always replaces the estimate with the reported usage.
 */
export const CHARS_PER_TOKEN = 3;

/** An upper bound of the input tokens for whatever will be serialized to the model. */
export function estimateTokens(parts: unknown[]): number {
  return Math.ceil(JSON.stringify(parts).length / CHARS_PER_TOKEN);
}
