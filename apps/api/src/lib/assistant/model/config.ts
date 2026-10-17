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
