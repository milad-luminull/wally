/** Three characters per token is below what any current tokenizer yields for German or English text, so the estimate over-reserves. */
export const CHARS_PER_TOKEN = 3;

/** An upper bound of the input tokens for whatever will be serialized to the model. */
export function estimateTokens(parts: unknown[]): number {
  return Math.ceil(JSON.stringify(parts).length / CHARS_PER_TOKEN);
}
