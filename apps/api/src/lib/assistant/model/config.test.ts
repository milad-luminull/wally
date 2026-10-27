import { describe, expect, it } from 'vitest';
import {
  defaultProviderOptions,
  GEMINI_3_SUGGESTION_THINKING_TOKENS,
  parseModelRef,
  resolveLanguageModel,
  suggestionCallSettings,
} from './config.js';

const env: Parameters<typeof resolveLanguageModel>[1] = {
  ASSISTANT_VERTEX_LOCATION: 'europe-west1',
  ASSISTANT_VERTEX_PROJECT: 'wally-test',
  FIREBASE_PROJECT_ID: 'wally-test',
};

describe('parseModelRef', () => {
  it('splits provider and model on the first colon', () => {
    expect(parseModelRef('vertex:gemini-3.8-flash')).toEqual({
      provider: 'vertex',
      model: 'gemini-3.8-flash',
    });
  });
  it('rejects unknown providers and malformed values', () => {
    for (const bad of [
      'openai:gpt',
      'vertex-anthropic:claude-sonnet-5-5',
      'vertex',
      ':gemini',
      'vertex:',
      'vertex:a:b',
    ]) {
      expect(() => parseModelRef(bad), bad).toThrow();
    }
  });
});

describe('resolveLanguageModel', () => {
  it('builds a Vertex model with the configured id without calling anything', () => {
    const model = resolveLanguageModel({ provider: 'vertex', model: 'gemini-3.8-flash' }, env);
    expect(model.modelId).toBe('gemini-3.8-flash');
    expect(model.provider).toContain('vertex');
  });
  it('falls back to the Firebase project id', () => {
    const model = resolveLanguageModel(
      { provider: 'vertex', model: 'gemini-3.8-flash' },
      { ...env, ASSISTANT_VERTEX_PROJECT: undefined },
    );
    expect(model.modelId).toBe('gemini-3.8-flash');
  });
});

describe('defaultProviderOptions', () => {
  it('bounds Gemini thinking by level', () => {
    expect(defaultProviderOptions({ provider: 'vertex', model: 'gemini-3.8-flash' })).toEqual({
      vertex: { thinkingConfig: { thinkingLevel: 'low' } },
    });
  });
  it('leaves other models alone', () => {
    expect(defaultProviderOptions({ provider: 'vertex', model: 'gemma-3-27b-it' })).toBeUndefined();
  });
});

describe('suggestionCallSettings', () => {
  it('gives Gemini 3 and later the lowest level 3.8 Flash lists, with room for it', () => {
    expect(suggestionCallSettings({ provider: 'vertex', model: 'gemini-3.8-flash' })).toEqual({
      providerOptions: { vertex: { thinkingConfig: { thinkingLevel: 'low' } } },
      thinkingTokens: GEMINI_3_SUGGESTION_THINKING_TOKENS,
    });
  });
  it('leaves other models alone', () => {
    expect(suggestionCallSettings({ provider: 'vertex', model: 'gemma-3-27b-it' })).toEqual({
      thinkingTokens: 0,
    });
  });
});
