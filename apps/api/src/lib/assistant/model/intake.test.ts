import { describe, expect, it } from 'vitest';
import { zodSchema } from 'ai';
import { modelIntakeSchema, modelIntakeWireSchema } from './intake.js';

/** Depth of arrays of objects nested inside arrays of objects in a JSON schema. */
function objectArraysInsideObjectArrays(schema: unknown, inside = false): number {
  if (!schema || typeof schema !== 'object') return 0;
  const node = schema as Record<string, unknown>;
  const isObjectArray =
    node.type === 'array' && (node.items as { type?: unknown } | undefined)?.type === 'object';
  const here = isObjectArray && inside ? 1 : 0;
  return (
    here +
    Object.values(node).reduce<number>(
      (sum, child) => sum + objectArraysInsideObjectArrays(child, inside || isObjectArray),
      0,
    )
  );
}

describe('the intake wire schema', () => {
  it('nests no array of objects inside another: Vertex answers 400 to that', () => {
    expect(objectArraysInsideObjectArrays(zodSchema(modelIntakeWireSchema).jsonSchema)).toBe(0);
  });

  it('reads the clarify field back as the last item', () => {
    const options = [
      { label: 'The renewal call', action: 'ask', text: 'What about the renewal call?' },
      { label: 'New note', action: 'note', text: 'Note for Andrea' },
    ];
    const parsed = modelIntakeSchema.parse({
      items: [{ kind: 'note', text: 'Dentist Friday', noteId: '' }],
      clarify: { question: 'The renewal call, or a new note?', options },
    });
    expect(parsed.items).toEqual([
      { kind: 'note', text: 'Dentist Friday', noteId: '', question: '', options: [] },
      {
        kind: 'clarify',
        text: '',
        noteId: '',
        question: 'The renewal call, or a new note?',
        options,
      },
    ]);
  });

  it('reads no clarify as the items alone, and drops an item that does not fit', () => {
    const parsed = modelIntakeSchema.parse({
      items: [{ kind: 'ask', text: 'What is due?', noteId: '' }, { kind: 'shout' }],
      clarify: null,
    });
    expect(parsed.items).toEqual([
      { kind: 'ask', text: 'What is due?', noteId: '', question: '', options: [] },
    ]);
  });
});
