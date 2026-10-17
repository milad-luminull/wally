import type { LanguageModel } from 'ai';
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
  'ASSISTANT_VERTEX_LOCATION' | 'ASSISTANT_VERTEX_PROJECT' | 'FIREBASE_PROJECT_ID'
>;

/** The library's model object; `LanguageModel` also admits a bare id string, which this never returns. */
type ResolvedLanguageModel = Exclude<LanguageModel, string>;

/** Builds the library's model object for a reference. No network call happens here. */
export function resolveLanguageModel(ref: ModelRef, env: VertexEnv): ResolvedLanguageModel {
  const settings = {
    project: env.ASSISTANT_VERTEX_PROJECT ?? env.FIREBASE_PROJECT_ID,
    location: env.ASSISTANT_VERTEX_LOCATION,
  };
  switch (ref.provider) {
    case 'vertex':
      return createGoogleVertex(settings)(ref.model);
    case 'vertex-anthropic':
      return createVertexAnthropic(settings)(ref.model);
  }
}
