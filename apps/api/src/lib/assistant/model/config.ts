import type { JSONValue, LanguageModel } from 'ai';
import { createGoogleVertex } from '@ai-sdk/google-vertex';
import type { Env } from '../../../env.js';
import type { ModelRef } from './types.js';

/** Gemini on Vertex is the only provider: the price table (budget/prices.ts) prices nothing else. */
const PROVIDERS = ['vertex'] as const;

/** Parses `provider:model`. Throws on an unknown provider or a malformed value. */
export function parseModelRef(value: string): ModelRef {
  const separator = value.indexOf(':');
  if (separator <= 0) throw new Error(`ASSISTANT_MODEL must be provider:model, got "${value}"`);
  const provider = value.slice(0, separator);
  const model = value.slice(separator + 1);
  if (!(PROVIDERS as readonly string[]).includes(provider))
    throw new Error(
      `Unknown assistant provider "${provider}"; expected one of ${PROVIDERS.join(', ')}`,
    );
  if (!model || model.includes(':')) throw new Error(`Invalid assistant model id "${model}"`);
  return { provider: provider as ModelRef['provider'], model };
}

type VertexEnv = Pick<
  Env,
  'ASSISTANT_VERTEX_LOCATION' | 'ASSISTANT_VERTEX_PROJECT' | 'FIREBASE_PROJECT_ID'
>;

/** The library's model object; `LanguageModel` also admits a bare id string, which this never returns. */
type ResolvedLanguageModel = Exclude<LanguageModel, string>;

/** Builds the library's model object for a reference. No network call happens here. */
export function resolveLanguageModel(ref: ModelRef, env: VertexEnv): ResolvedLanguageModel {
  const settings = {
    project: env.ASSISTANT_VERTEX_PROJECT ?? env.FIREBASE_PROJECT_ID,
    location: env.ASSISTANT_VERTEX_LOCATION,
    // No credentials are passed: the provider uses Application Default Credentials (the
    // Cloud Run runtime account, or a developer's `gcloud auth application-default login`).
  };
  return createGoogleVertex(settings)(ref.model);
}

/** Provider options keyed by the provider's own name, as the library passes them on. */
export type ModelProviderOptions = Record<string, Record<string, JSONValue>>;

/**
 * Bounds a model's thinking so it leaves room for the answer. Gemini thinks by default, and
 * its thinking counts against the step's maxOutputTokens, which is also what the ledger
 * reserves: unbounded thinking cannot exceed the charge, but it can use up the allowance and
 * leave the answer cut off. Per @ai-sdk/google's documented thinkingConfig (read under
 * providerOptions.vertex for the Vertex provider): Gemini 3 and later take `thinkingLevel`
 * ('low' is accepted by every Gemini 3 model it lists).
 */
export function defaultProviderOptions(ref: ModelRef): ModelProviderOptions | undefined {
  if (!ref.model.startsWith('gemini-')) return undefined;
  return { vertex: { thinkingConfig: { thinkingLevel: 'low' } } };
}

/**
 * Room added for a Gemini 3+ model's thinking at `thinkingLevel: 'low'`, which no setting turns
 * off on 3.8 or 3.7 Flash (their lowest listed level is LOW) and which has no token bound of its
 * own. Sized so a 256-token answer gets the same 1024 total a question step runs 'low' with
 * (turn.ts); whether that is always enough is unverified, and running short ends as
 * finishReason 'length', which the runner reports as nothing proposed.
 */
export const GEMINI_3_SUGGESTION_THINKING_TOKENS = 768;

/** How one suggestion call bounds the model's thinking, and how much room that thinking takes. */
export interface SuggestionCallSettings {
  providerOptions?: ModelProviderOptions;
  /**
   * Tokens the call may spend thinking, on top of the answer's allowance. Thinking counts
   * inside the request's maxOutputTokens and is billed as output (Gemini API thinking page),
   * so the runner sends and announces the answer's allowance plus this.
   */
  thinkingTokens: number;
}

/**
 * A suggestion's answer is a few short JSON fields (RFC-0005-wallybot-inline.md §4), so it gets its
 * own thinking settings rather than a question step's (`defaultProviderOptions`, sized for
 * 1024): the lowest thinking level, with room for it added to the call's allowance so
 * thinking can never use up the answer's room.
 */
export function suggestionCallSettings(ref: ModelRef): SuggestionCallSettings {
  if (!ref.model.startsWith('gemini-')) return { thinkingTokens: 0 };
  return {
    providerOptions: { vertex: { thinkingConfig: { thinkingLevel: 'low' } } },
    thinkingTokens: GEMINI_3_SUGGESTION_THINKING_TOKENS,
  };
}
