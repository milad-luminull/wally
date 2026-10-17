import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Switch } from './switch';

describe('Switch', () => {
  it('toggles on click and reports the next state', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Test" checked={false} onCheckedChange={onCheckedChange} />);
    const control = screen.getByRole('switch', { name: 'Test' });
    expect(control).toHaveAttribute('aria-checked', 'false');
    await user.click(control);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  /* jsdom evaluates neither media queries nor Tailwind, so this pins the class contract that
     gives a touch pointer its 40px target (BRAND.md: controls grow to at least 40px on a
     coarse pointer): a positioned button, and an invisible ::after reaching 10px past the
     24px track's padding box above and below (22 + 20 = 42px). */
  it('carries an invisible hit area out to 40px on a coarse pointer', () => {
    render(<Switch aria-label="Test" checked onCheckedChange={() => {}} />);
    const classes = screen.getByRole('switch', { name: 'Test' }).className.split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining([
        'relative',
        '[@media(pointer:coarse)]:h-6',
        'after:absolute',
        'after:content-[""]',
        '[@media(pointer:coarse)]:after:-inset-y-[10px]',
      ]),
    );
  });
});
