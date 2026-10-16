import { describe, expect, it } from 'vitest';
import { parseCapture, type CaptureMember } from './parseCapture';

// 2026-10-16 is a Friday.
const today = new Date(2026, 9, 16, 12, 0, 0);
const members: CaptureMember[] = [
  { id: 'u-anna', displayName: 'Anna Kowalski', email: 'anna@example.com' },
  { id: 'u-max', displayName: null, email: 'max.mustermann@example.com' },
];
const de = (text: string) => parseCapture(text, { language: 'de', today, members });
const en = (text: string) => parseCapture(text, { language: 'en', today, members });

describe('parseCapture dates', () => {
  it('reads relative words in German and English', () => {
    expect(de('Müller anrufen heute').dueDate).toMatchObject({ iso: '2026-10-16', text: 'heute' });
    expect(de('morgen Angebot').dueDate).toMatchObject({ iso: '2026-10-17', text: 'morgen' });
    expect(de('übermorgen').dueDate?.iso).toBe('2026-10-18');
    expect(en('call Anna tomorrow').dueDate).toMatchObject({ iso: '2026-10-17', text: 'tomorrow' });
    expect(en('today').dueDate?.iso).toBe('2026-10-16');
  });
  it('reads weekdays as the next occurrence, today included', () => {
    expect(de('bis Freitag').dueDate).toMatchObject({ iso: '2026-10-16', text: 'Freitag' });
    expect(de('am Montag').dueDate?.iso).toBe('2026-10-19');
    expect(de('nächsten Dienstag').dueDate?.iso).toBe('2026-10-20');
    expect(en('by Monday').dueDate?.iso).toBe('2026-10-19');
    expect(en('next Fri').dueDate?.iso).toBe('2026-10-23');
    expect(de('Mo Bericht').dueDate?.iso).toBe('2026-10-19');
    expect(de('Montagsbesprechung').dueDate).toBeNull();
  });
  it('reads next week, in N days and numeric dates', () => {
    expect(de('nächste Woche').dueDate?.iso).toBe('2026-10-19');
    expect(en('next week').dueDate?.iso).toBe('2026-10-19');
    expect(de('in 3 Tagen').dueDate?.iso).toBe('2026-10-19');
    expect(en('in 10 days').dueDate?.iso).toBe('2026-10-26');
    expect(de('am 20.10.').dueDate).toMatchObject({ iso: '2026-10-20', text: '20.10.' });
    expect(de('am 3.1.').dueDate?.iso).toBe('2027-01-03');
    expect(de('am 20.10.2027').dueDate?.iso).toBe('2027-10-20');
    expect(en('on 2026-11-02').dueDate?.iso).toBe('2026-11-02');
  });
  it('takes the earliest date in the text and skips impossible dates', () => {
    expect(de('Freitag oder morgen').dueDate).toMatchObject({ iso: '2026-10-16', text: 'Freitag' });
    expect(en('on 2026-13-40 or tomorrow').dueDate?.text).toBe('tomorrow');
    expect(de('am 31.11. oder 20.10.').dueDate?.text).toBe('20.10.');
    expect(de('So, fertig').dueDate).toBeNull();
  });
  it('records the position of the match', () => {
    const p = de('Müller anrufen Freitag');
    expect(p.dueDate).toMatchObject({ start: 15, end: 22 });
  });
});

describe('parseCapture people', () => {
  it('matches @mentions by first name, full name or email', () => {
    expect(de('Vertrag @anna').assignee).toMatchObject({ memberId: 'u-anna', text: '@anna' });
    expect(de('@Anna Kowalski fragen').assignee?.memberId).toBe('u-anna');
    expect(en('ask @max.mustermann').assignee?.memberId).toBe('u-max');
    expect(de('@niemand').assignee).toBeNull();
    expect(de('@niemand und @anna, bitte').assignee).toMatchObject({
      memberId: 'u-anna',
      text: '@anna',
    });
  });
  it('matches a full display name without @', () => {
    expect(de('Anna Kowalski anrufen').assignee).toMatchObject({
      memberId: 'u-anna',
      text: 'Anna Kowalski',
    });
    expect(de('Anna anrufen').assignee).toBeNull();
  });
});

describe('parseCapture urgency', () => {
  it('maps urgency words to a priority', () => {
    expect(de('dringend Müller anrufen').priority).toMatchObject({
      value: 'HOCH',
      text: 'dringend',
    });
    expect(en('urgent: call back').priority?.value).toBe('HOCH');
    expect(de('irgendwann Keller aufräumen').priority?.value).toBe('NIEDRIG');
    expect(en('someday read that book').priority?.value).toBe('NIEDRIG');
    expect(de('Hochzeit planen').priority).toBeNull();
    expect(de('irgendwann, nicht dringend').priority?.value).toBe('NIEDRIG');
  });
});

describe('parseCapture together', () => {
  it('finds all three in one line and nothing in plain text', () => {
    const p = de('Müller anrufen Freitag @anna dringend');
    expect(p.dueDate?.iso).toBe('2026-10-16');
    expect(p.assignee?.memberId).toBe('u-anna');
    expect(p.priority?.value).toBe('HOCH');
    expect(de('Blumen gießen')).toEqual({ dueDate: null, assignee: null, priority: null });
    expect(de('')).toEqual({ dueDate: null, assignee: null, priority: null });
  });
});
