import type { JSONValue, LanguageModel } from 'ai';
import { createGoogleVertex } from '@ai-sdk/google-vertex';
import { createVertexAnthropic } from '@ai-sdk/google-vertex/anthropic';
import type { Env } from '../../../env.js';
import type { ModelRef } from './types.js';

const PROVIDERS = ['vertex', 'vertex-anthropic'] as const;

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
  | 'ASSISTANT_VERTEX_LOCATION'
  | 'ASSISTANT_VERTEX_PROJECT'
  | 'FIREBASE_PROJECT_ID'
  | 'FIREBASE_CLIENT_EMAIL'
  | 'FIREBASE_PRIVATE_KEY'
>;

/** The library's model object; `LanguageModel` also admits a bare id string, which this never returns. */
type ResolvedLanguageModel = Exclude<LanguageModel, string>;

/** Builds the library's model object for a reference. No network call happens here. */
export function resolveLanguageModel(ref: ModelRef, env: VertexEnv): ResolvedLanguageModel {
  const settings = {
    project: env.ASSISTANT_VERTEX_PROJECT ?? env.FIREBASE_PROJECT_ID,
    location: env.ASSISTANT_VERTEX_LOCATION,
    // Locally the Firebase service account doubles as the Vertex caller once it has
    // roles/aiplatform.user; on Cloud Run the runtime account applies by default.
    ...(env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY
      ? {
          googleAuthOptions: {
            credentials: {
              client_email: env.FIREBASE_CLIENT_EMAIL,
              private_key: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
            },
          },
        }
      : {}),
  };
  switch (ref.provider) {
    case 'vertex':
      return createGoogleVertex(settings)(ref.model);
    case 'vertex-anthropic':
      return createVertexAnthropic(settings)(ref.model);
  }
}

/** Provider options keyed by the provider's own name, as the library passes them on. */
export type ModelProviderOptions = Record<string, Record<string, JSONValue>>;

/** Gemini 2.5's thinking budget, in tokens: half of a step's output allowance (turn.ts). */
export const GEMINI_25_THINKING_BUDGET = 512;

/**
 * Bounds a model's thinking so it leaves room for the answer. Gemini thinks by default, and
 * its thinking counts against the step's maxOutputTokens, which is also what the ledger
 * reserves: unbounded thinking cannot exceed the charge, but it can use up the allowance and
 * leave the answer cut off. Per @ai-sdk/google's documented thinkingConfig (read under
 * providerOptions.vertex for the Vertex provider): Gemini 3 and later take `thinkingLevel`
 * ('low' is accepted by every Gemini 3 model it lists), Gemini 2.5 takes `thinkingBudget`.
 * Claude on Vertex thinks only when asked to, so it needs nothing.
 */
export function defaultProviderOptions(ref: ModelRef): ModelProviderOptions | undefined {
  if (ref.provider !== 'vertex' || !ref.model.startsWith('gemini-')) return undefined;
  const thinkingConfig = ref.model.startsWith('gemini-2.5')
    ? { thinkingBudget: GEMINI_25_THINKING_BUDGET }
    : { thinkingLevel: 'low' };
  return { vertex: { thinkingConfig } };
}

/**
 * Gemini 2.5 Pro's lowest thinking budget. Vertex AI's thinking page: Pro takes 128 to 32,768
 * and its thinking cannot be turned off; Flash and Flash-Lite turn it off with a budget of 0.
 */
export const GEMINI_25_PRO_MIN_THINKING_BUDGET = 128;

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
 * 1024): off where the model allows it, the documented minimum otherwise, with that minimum
 * added to the call's allowance so thinking can never use up the answer's room. Claude on
 * Vertex thinks only when asked to, so it needs nothing.
 */
export function suggestionCallSettings(ref: ModelRef): SuggestionCallSettings {
  if (ref.provider !== 'vertex' || !ref.model.startsWith('gemini-')) return { thinkingTokens: 0 };
  if (ref.model.startsWith('gemini-2.5-pro'))
    return {
      providerOptions: {
        vertex: { thinkingConfig: { thinkingBudget: GEMINI_25_PRO_MIN_THINKING_BUDGET } },
      },
      thinkingTokens: GEMINI_25_PRO_MIN_THINKING_BUDGET,
    };
  if (ref.model.startsWith('gemini-2.5'))
    return {
      providerOptions: { vertex: { thinkingConfig: { thinkingBudget: 0 } } },
      thinkingTokens: 0,
    };
  return {
    providerOptions: { vertex: { thinkingConfig: { thinkingLevel: 'low' } } },
    thinkingTokens: GEMINI_3_SUGGESTION_THINKING_TOKENS,
  };
}
