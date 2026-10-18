import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { cancelFlight, FLIP_ANIMATION_ID, useFlip } from './useFlip';

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

/** A card per id, in the zone the test puts it in; the zone decides where it is laid out. */
function Zoned({
  zones,
  ids,
  destinations,
}: {
  zones: Record<string, string>;
  ids: string[];
  destinations?: Record<string, string>;
}) {
  useFlip(ids, {
    zoneOf: (id) => zones[id],
    destinationOf: destinations ? (id) => destinations[id] : undefined,
  });
  return (
    <div data-scroller>
      {Object.entries(zones).map(([id, zone], i) => (
        <div key={id} data-note-id={id} data-zone={zone} data-row={i} />
      ))}
    </div>
  );
}

interface FakeAnimation {
  id: string;
  playState: AnimationPlayState;
  cancel: () => void;
  from: { dx: number; dy: number };
}

describe('useFlip on the wall: only a card that changes zone travels', () => {
  /** Zone A is the top of the wall, zone B 300 px lower; each row is 120 px under the last. */
  const ZONE_TOP: Record<string, number> = { A: 0, B: 300 };
  let scrolled = 0;
  let flying: Map<Element, FakeAnimation[]>;
  let animate: ReturnType<typeof vi.fn>;

  /** Where the card is laid out, at rest, in the viewport. */
  const restTop = (el: HTMLElement) =>
    ZONE_TOP[el.dataset.zone!]! + Number(el.dataset.row) * 120 - scrolled;

  beforeEach(() => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    scrolled = 0;
    flying = new Map();
    animate = vi.fn(function (
      this: HTMLElement,
      frames: Keyframe[],
      options: KeyframeAnimationOptions,
    ) {
      const [, dx, dy] = /translate\((-?\d+)px, (-?\d+)px\)/.exec(String(frames[0]!.transform))!;
      const animation: FakeAnimation = {
        id: options.id ?? '',
        playState: 'running',
        cancel: vi.fn(() => {
          animation.playState = 'idle';
        }),
        from: { dx: Number(dx), dy: Number(dy) },
      };
      flying.set(this, [...(flying.get(this) ?? []), animation]);
      return animation;
    });
    Object.defineProperty(HTMLElement.prototype, 'animate', { value: animate, configurable: true });
    Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
      value: function (this: HTMLElement) {
        return flying.get(this) ?? [];
      },
      configurable: true,
    });
    // A travelling card's box includes the travel's transform: while it runs (or waits in its
    // delay, held by fill: backwards), the card is drawn at the place it left.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const running = (flying.get(this) ?? []).find(
        (a) => a.playState === 'running' || a.playState === 'paused',
      );
      const top = restTop(this) + (running ? running.from.dy : 0);
      return { left: running ? running.from.dx : 0, top, width: 248, height: 104 } as DOMRect;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (HTMLElement.prototype as { getAnimations?: unknown }).getAnimations;
  });

  it('a render during the travel neither re-measures the travelling cards nor starts them again', () => {
    const { rerender } = render(<Zoned zones={{ a: 'A', c: 'A' }} ids={['a', 'c']} />);
    rerender(<Zoned zones={{ a: 'B', c: 'B' }} ids={['a', 'c']} />);
    expect(animate).toHaveBeenCalledTimes(2);
    expect(animate.mock.calls[0]![0][0].transform).toBe('translate(0px, -300px)');
    expect(animate.mock.calls[1]![1]).toMatchObject({ id: FLIP_ANIMATION_ID, delay: 40 });

    // The server's answer and the refetch render the wall again while both still travel, and
    // their boxes now read the place they left.
    rerender(<Zoned zones={{ a: 'B', c: 'B' }} ids={['a', 'c']} />);
    rerender(<Zoned zones={{ a: 'B', c: 'B' }} ids={['a', 'c']} />);
    expect(animate).toHaveBeenCalledTimes(2);
    for (const list of flying.values())
      for (const a of list) expect(a.cancel).not.toHaveBeenCalled();

    // Landed: a later render measures them at rest and moves nothing.
    for (const list of flying.values()) for (const a of list) a.playState = 'finished';
    rerender(<Zoned zones={{ a: 'B', c: 'B' }} ids={['a', 'c']} />);
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it('a scroll between renders is no move, and a card that does change zone travels from where it is now', () => {
    const { container, rerender } = render(<Zoned zones={{ a: 'A', b: 'A' }} ids={['a', 'b']} />);
    // The person scrolls the wall by 120 px: both cards are higher in the viewport.
    scrolled = 120;
    fireEvent.scroll(container.querySelector('[data-scroller]')!);
    rerender(<Zoned zones={{ a: 'B', b: 'A' }} ids={['a', 'b']} />);
    // Only a travels, and from its place after the scroll (-120), not before it (0).
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.instances[0]).toBe(container.querySelector('[data-note-id="a"]'));
    expect(animate.mock.calls[0]![0][0].transform).toBe('translate(0px, -300px)');
  });

  it('a scroll with no render in between moves nothing on the next render', () => {
    const { rerender } = render(<Zoned zones={{ a: 'A', b: 'A' }} ids={['a', 'b']} />);
    scrolled = 200;
    rerender(<Zoned zones={{ a: 'A', b: 'A' }} ids={['b', 'a']} />);
    expect(animate).not.toHaveBeenCalled();
  });

  it('a card travels when it arrives where it is meant to go, and goes back without motion', () => {
    const destinations = { a: 'B' };
    const { rerender } = render(
      <Zoned zones={{ a: 'A' }} ids={['a']} destinations={destinations} />,
    );
    // A keep: the cache moves the note to its destination.
    rerender(<Zoned zones={{ a: 'B' }} ids={['a']} destinations={destinations} />);
    expect(animate).toHaveBeenCalledTimes(1);
    for (const list of flying.values()) for (const a of list) a.playState = 'finished';
    // The server skipped it (or refused, or an undo): the cache puts it back while the batch
    // still tracks it. It lands where it was, with no travel.
    rerender(<Zoned zones={{ a: 'A' }} ids={['a']} destinations={destinations} />);
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it('cancelFlight stops the travel and leaves any other animation alone', () => {
    render(<Zoned zones={{ a: 'A' }} ids={[]} />);
    const el = document.querySelector<HTMLElement>('[data-note-id="a"]')!;
    const travel = el.animate([{ transform: 'translate(0px, 10px)' }], { id: FLIP_ANIMATION_ID });
    const landing = el.animate([{ transform: 'translate(0px, 10px)' }], {});
    cancelFlight(el);
    expect(travel.cancel).toHaveBeenCalledTimes(1);
    expect(landing.cancel).not.toHaveBeenCalled();
  });
});
