import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { DemoInput } from './DemoInput';

/** The highlighted words, each with its colour, as the ink layer shows them. */
function highlights(value: string) {
  const { container } = render(
    <DemoInput value={value} label="Note" placeholder="" onFocus={() => {}} onChange={() => {}} />,
  );
  return [...container.querySelectorAll('span[data-colour]')].map(
    (span) => `${span.textContent}:${span.getAttribute('data-colour')}`,
  );
}

describe('DemoInput', () => {
  it('highlights every weekday the demo parses, German ones included', () => {
    expect(highlights('review contract Montag Dienstag Mittwoch Freitag')).toEqual([
      'Montag:oat',
      'Dienstag:oat',
      'Mittwoch:oat',
      'Freitag:oat',
    ]);
  });

  it('marks an idea the way the demo reads one, with or without the colon', () => {
    expect(highlights('Idee: simplify onboarding')).toEqual(['Idee::rose']);
    expect(highlights('idea simplify the flow')).toEqual(['idea:rose']);
  });

  it('colours people, times and urgency', () => {
    expect(highlights('call sam 2pm 30m urgent')).toEqual([
      'sam:sky',
      '2pm:mint',
      '30m:mint',
      'urgent:rose',
    ]);
  });
});
