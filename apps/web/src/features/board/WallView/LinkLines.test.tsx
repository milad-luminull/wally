import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { NOTE_CARD_HEIGHT, NOTE_CARD_WIDTH } from '@wally/shared';
import { makeNote, makeSuggestionMark } from '@/test/fixtures';
import type { PendingProps } from '../Suggestions/pendingProps';
import { LinkLines } from './LinkLines';

const a = makeNote({ id: 'a', freeX: 0, freeY: 0, links: ['b'] });
const b = makeNote({ id: 'b', freeX: 400, freeY: 300, links: ['a'] });
const c = makeNote({ id: 'c', freeX: 800, freeY: 0, links: ['missing'] });

describe('LinkLines', () => {
  it('keeps a solid relation solid even when an earlier note proposes the reverse', () => {
    const fresh = makeNote({ id: 'a', links: [] });
    const kept = makeNote({ id: 'b', links: ['a'] });
    const mark = makeSuggestionMark({ fields: ['links'], links: [0] });
    mark.suggestion!.fields.links = {
      items: [{ index: 0, noteId: 'b', title: 'B', reason: 'r' }],
      reason: 'r',
    };
    const { container } = render(
      <LinkLines
        notes={[fresh, kept]}
        pendingFor={(id) => (id === 'a' ? ({ mark } as PendingProps) : undefined)}
      />,
    );
    expect(container.querySelectorAll('line')).toHaveLength(1);
    expect(container.querySelector('line')).not.toHaveAttribute('data-pending');
  });
  it('removes pending lines when unticked or no longer pending, and follows positions', () => {
    const fresh = makeNote({ id: 'n', links: [] });
    const mark = makeSuggestionMark({ fields: ['links'], links: [0] });
    mark.suggestion!.fields.links = {
      items: [{ index: 0, noteId: 'b', title: 'B', reason: 'r' }],
      reason: 'r',
    };
    const draw = () => (
      <LinkLines notes={[fresh, b]} pendingFor={() => ({ mark }) as PendingProps} />
    );
    const { container, rerender } = render(draw());
    expect(container.querySelectorAll('line[data-pending]')).toHaveLength(1);
    mark.links = [];
    rerender(draw());
    expect(container.querySelector('line')).toBeNull();
    mark.links = [0];
    mark.phase = 'kept';
    rerender(draw());
    expect(container.querySelector('line')).toBeNull();
    rerender(<LinkLines notes={[{ ...a, freeX: 200 }, b]} />);
    expect(container.querySelector('line')).toHaveAttribute(
      'x1',
      String(200 + NOTE_CARD_WIDTH / 2),
    );
  });
  it('draws one solid hairline per related pair, centre to centre, and none to a note not on the canvas', () => {
    const { container } = render(<LinkLines notes={[a, b, c]} pendingFor={() => undefined} />);
    const lines = container.querySelectorAll('line');
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line.getAttribute('data-link')).toBe('a:b');
    expect(line).not.toHaveAttribute('data-pending');
    expect(line.getAttribute('x1')).toBe(String(NOTE_CARD_WIDTH / 2));
    expect(line.getAttribute('y1')).toBe(String(NOTE_CARD_HEIGHT / 2));
    expect(line.getAttribute('x2')).toBe(String(400 + NOTE_CARD_WIDTH / 2));
    expect(line.getAttribute('y2')).toBe(String(300 + NOTE_CARD_HEIGHT / 2));
  });

  it('draws a dashed line for each ticked proposed link while the proposal is pending', () => {
    const fresh = makeNote({ id: 'n', freeX: 100, freeY: 100, links: [] });
    const mark = makeSuggestionMark({ fields: ['links'], links: [2] });
    mark.suggestion!.fields.links = {
      items: [
        { index: 0, noteId: 'a', title: 'A', reason: 'r' },
        { index: 2, noteId: 'b', title: 'B', reason: 'r' },
      ],
      reason: 'r',
    };
    const pendingFor = (id: string): PendingProps | undefined =>
      id === 'n' ? ({ mark } as unknown as PendingProps) : undefined;
    const { container } = render(<LinkLines notes={[a, b, fresh]} pendingFor={pendingFor} />);
    const pending = container.querySelectorAll('line[data-pending]');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.getAttribute('data-link')).toBe('b:n');
  });
});
