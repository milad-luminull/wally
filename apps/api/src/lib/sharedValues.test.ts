import {
  boardPreferencesSchema,
  boardViewSchema,
  boardViewValues,
  horizonForDueDate,
  noteColourSchema,
  noteColourValues,
  noteCreateSchema,
  noteHorizonSchema,
  noteHorizonValues,
  noteListQuerySchema,
  notePrioritySchema,
  notePriorityValues,
  suggestionFieldsSchema,
} from '@wally/shared';
import { zodSchema } from 'ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * The spellings these values had before ADR-0014 and ADR-0024. They are spelled here, and
 * only here, to show they are refused like any unknown value.
 */
const OLD = {
  priority: ['HOCH', 'MITTEL', 'NIEDRIG'],
  horizon: ['HEUTE', 'DIESE_WOCHE', 'SPAETER'],
  colour: [
    'WEISS',
    'EIS',
    'SAND',
    'MINZE',
    'HIMMEL',
    'NEBEL',
    'BUTTER',
    'LEHM',
    'MALVE',
    'FLIEDER',
    'SEEGRUEN',
    'SALBEI',
    'OLIV',
  ],
  view: ['wand'],
} as const;

describe('the shared value sets', () => {
  it('stores the English values of ADR-0014', () => {
    expect(notePriorityValues).toEqual(['HIGH', 'MEDIUM', 'LOW']);
    expect(noteHorizonValues).toEqual(['TODAY', 'THIS_WEEK', 'LATER']);
    expect(noteColourValues).toEqual([
      'CHALK',
      'ICE',
      'STONE',
      'MINT',
      'SKY',
      'MIST',
      'OAT',
      'CLAY',
      'ROSE',
      'MALLOW',
      'HEATHER',
      'SEA_GREEN',
      'SAGE',
      'OLIVE',
    ]);
    expect(boardViewValues).toEqual(['wall', 'list']);
  });

  it('defaults a new note to MEDIUM, TODAY and CHALK', () => {
    const note = noteCreateSchema.parse({});
    expect(note.priority).toBe('MEDIUM');
    expect(note.horizon).toBe('TODAY');
    expect(note.colour).toBe('CHALK');
  });

  it('refuses the old spellings like any unknown value', () => {
    for (const value of OLD.priority)
      expect(notePrioritySchema.safeParse(value).success).toBe(false);
    for (const value of OLD.horizon) expect(noteHorizonSchema.safeParse(value).success).toBe(false);
    for (const value of OLD.colour) expect(noteColourSchema.safeParse(value).success).toBe(false);
    for (const value of OLD.view) expect(boardViewSchema.safeParse(value).success).toBe(false);

    expect(noteListQuerySchema.safeParse({ priority: OLD.priority[0] }).success).toBe(false);
    expect(
      boardPreferencesSchema.safeParse({
        view: OLD.view[0],
        axis: 'horizon',
        done: true,
        mine: false,
        priority: [],
      }).success,
    ).toBe(false);
  });

  it('proposes only This week or Later, and High or Low', () => {
    const { horizon, priority } = suggestionFieldsSchema.shape;
    expect(horizon.safeParse({ value: 'THIS_WEEK', reason: '' }).success).toBe(true);
    expect(horizon.safeParse({ value: 'TODAY', reason: '' }).success).toBe(false);
    expect(priority.safeParse({ value: 'LOW', reason: '' }).success).toBe(true);
    expect(priority.safeParse({ value: 'MEDIUM', reason: '' }).success).toBe(false);
  });

  it('places a dated note on the horizon in English', () => {
    // 2026-10-27 is a Tuesday; its week ends on Sunday 2026-11-01.
    const today = '2026-10-27';
    expect(horizonForDueDate(today, today)).toBe('TODAY');
    expect(horizonForDueDate('2026-11-01', today)).toBe('THIS_WEEK');
    expect(horizonForDueDate('2026-11-02', today)).toBe('LATER');
  });

  it('publishes the English values in JSON schema', async () => {
    const schema = z.object({
      p: notePrioritySchema,
      h: noteHorizonSchema,
      c: noteColourSchema,
      v: boardViewSchema,
    });
    const json = JSON.stringify(await zodSchema(schema).jsonSchema);
    expect(json).toContain('"enum":["HIGH","MEDIUM","LOW"]');
    expect(json).toContain('"SEA_GREEN"');
  });
});
