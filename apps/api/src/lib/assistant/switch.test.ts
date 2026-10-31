import { describe, expect, it } from 'vitest';
import { assistantEnabledFor } from './switch.js';

describe('assistantEnabledFor', () => {
  it('is off when the deployment switch is off, whatever the board says', () => {
    expect(assistantEnabledFor({ ASSISTANT_ENABLED: false }, { assistantDisabled: false })).toBe(
      false,
    );
  });
  it('is on when the deployment switch is on and the board has not switched it off', () => {
    expect(assistantEnabledFor({ ASSISTANT_ENABLED: true }, { assistantDisabled: false })).toBe(
      true,
    );
  });
  it('is off when the board owner switched it off', () => {
    expect(assistantEnabledFor({ ASSISTANT_ENABLED: true }, { assistantDisabled: true })).toBe(
      false,
    );
  });
});
