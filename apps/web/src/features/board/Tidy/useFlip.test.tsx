import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useFlip } from './useFlip';

function Board({ order, ids }: { order: string[]; ids: string[] }) {
  useFlip(ids);
  return (
    <div>
      {order.map((id, i) => (
        <div key={id} data-note-id={id} data-top={i * 100} />
      ))}
    </div>
  );
}

describe('useFlip', () => {
  it('animates a tracked card from its old place to its new one, staggered, and leaves the rest', () => {
    const animate = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'animate', { value: animate, configurable: true });
    const rect = (el: Element) =>
      ({
        left: 0,
        top: Number((el as HTMLElement).dataset.top),
        width: 248,
        height: 104,
      }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return rect(this);
    });
    const { rerender } = render(<Board order={['a', 'b', 'c']} ids={['a', 'c']} />);
    expect(animate).not.toHaveBeenCalled();
    rerender(<Board order={['c', 'b', 'a']} ids={['a', 'c']} />);
    expect(animate).toHaveBeenCalledTimes(2);
    const [frames, options] = animate.mock.calls[0]!;
    expect(frames[0].transform).toBe('translate(0px, -200px)');
    expect(frames[1].transform).toBe('translate(0, 0)');
    expect(options).toMatchObject({ duration: 180, delay: 0, fill: 'backwards' });
    expect(animate.mock.calls[1]![1]).toMatchObject({ delay: 40 });
    vi.restoreAllMocks();
  });

  it('does nothing under reduced motion', () => {
    const animate = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'animate', { value: animate, configurable: true });
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    const { rerender } = render(<Board order={['a', 'b']} ids={['a']} />);
    rerender(<Board order={['b', 'a']} ids={['a']} />);
    expect(animate).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
