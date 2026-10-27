import { describe, expect, it } from 'vitest';
import {
  defaultProviderOptions,
  GEMINI_25_PRO_MIN_THINKING_BUDGET,
  GEMINI_25_THINKING_BUDGET,
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
    expect(parseModelRef('vertex-anthropic:claude-sonnet-5-5')).toEqual({
      provider: 'vertex-anthropic',
      model: 'claude-sonnet-5-5',
    });
  });
  it('rejects unknown providers and malformed values', () => {
    for (const bad of ['openai:gpt', 'vertex', ':gemini', 'vertex:', 'vertex:a:b']) {
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
  it('builds a Claude-on-Vertex model', () => {
    const model = resolveLanguageModel(
      { provider: 'vertex-anthropic', model: 'claude-sonnet-5-5' },
      env,
    );
    expect(model.modelId).toBe('claude-sonnet-5-5');
    // The installed provider names itself `googleVertex.anthropic.messages`.
    expect(model.provider).toMatch(/vertex/i);
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
  it('bounds Gemini thinking by level from Gemini 3 on, and by budget on Gemini 2.5', () => {
    expect(defaultProviderOptions({ provider: 'vertex', model: 'gemini-3.8-flash' })).toEqual({
      vertex: { thinkingConfig: { thinkingLevel: 'low' } },
    });
    expect(defaultProviderOptions({ provider: 'vertex', model: 'gemini-2.5-flash' })).toEqual({
      vertex: { thinkingConfig: { thinkingBudget: GEMINI_25_THINKING_BUDGET } },
    });
  });
  it('leaves other models alone', () => {
    expect(
      defaultProviderOptions({ provider: 'vertex-anthropic', model: 'claude-sonnet-5-5' }),
    ).toBeUndefined();
    expect(defaultProviderOptions({ provider: 'vertex', model: 'gemma-3-27b-it' })).toBeUndefined();
  });
});

describe('suggestionCallSettings', () => {
  it('turns thinking off on Gemini 2.5 Flash and Flash-Lite, with no room added', () => {
    for (const model of ['gemini-2.5-flash', 'gemini-2.5-flash-lite']) {
      expect(suggestionCallSettings({ provider: 'vertex', model }), model).toEqual({
        providerOptions: { vertex: { thinkingConfig: { thinkingBudget: 0 } } },
        thinkingTokens: 0,
      });
    }
  });
  it('gives Gemini 2.5 Pro its minimum budget and exactly that much room', () => {
    expect(suggestionCallSettings({ provider: 'vertex', model: 'gemini-2.5-pro' })).toEqual({
      providerOptions: {
        vertex: { thinkingConfig: { thinkingBudget: GEMINI_25_PRO_MIN_THINKING_BUDGET } },
      },
      thinkingTokens: GEMINI_25_PRO_MIN_THINKING_BUDGET,
    });
  });
  it('gives Gemini 3 and later the lowest level 3.8 Flash lists, with room for it', () => {
    expect(suggestionCallSettings({ provider: 'vertex', model: 'gemini-3.8-flash' })).toEqual({
      providerOptions: { vertex: { thinkingConfig: { thinkingLevel: 'low' } } },
      thinkingTokens: GEMINI_3_SUGGESTION_THINKING_TOKENS,
    });
  });
  it('never lets a numeric budget exceed the room it adds', () => {
    for (const model of ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro']) {
      const settings = suggestionCallSettings({ provider: 'vertex', model });
      const budget = (
        settings.providerOptions?.vertex?.thinkingConfig as { thinkingBudget: number }
      ).thinkingBudget;
      expect(budget, model).toBeLessThanOrEqual(settings.thinkingTokens);
    }
  });
  it('leaves Claude on Vertex alone', () => {
    expect(
      suggestionCallSettings({ provider: 'vertex-anthropic', model: 'claude-sonnet-5-5' }),
    ).toEqual({ thinkingTokens: 0 });
  });
});
