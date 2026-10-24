import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cardWidgetHtml } from '../../../api/src/lib/mcp/widget.js';

const data = {
  view: 'card',
  board: { id: 'board', name: 'Project board', url: 'http://localhost:5174/boards/board' },
  total: 1,
  nextCursor: null,
  cards: [
    {
      id: 'note',
      title: '<img src=x onerror=alert(1)>',
      description: 'First line\nSecond line',
      status: 'OPEN',
      priority: 'MITTEL',
      horizon: 'HEUTE',
      dueDate: '2026-10-22',
      assignee: 'A person',
      tags: ['<script>'],
      colour: 'WEISS',
      revision: 1,
      subtaskSummary: { done: 1, total: 2 },
      url: 'http://localhost:5174/boards/board?note=note',
    },
  ],
};
let listeners: EventListener[];
const host = (message: unknown, source: MessageEventSource = window) =>
  window.dispatchEvent(
    new MessageEvent('message', { data: { jsonrpc: '2.0', ...(message as object) }, source }),
  );
const result = (value: unknown) => host({ method: 'ui/notifications/tool-result', params: value });
beforeEach(() => {
  vi.useFakeTimers();
  listeners = [];
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    if (type === 'message') listeners.push(listener as EventListener);
    add(type, listener, options);
  });
  vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  const html = new DOMParser().parseFromString(
    cardWidgetHtml('http://localhost:5174'),
    'text/html',
  );
  const script = html.querySelector('script')!.textContent!;
  html.querySelector('script')!.remove();
  document.body.innerHTML = html.body.innerHTML;
  // Execute the exact shipped widget script in this test's isolated DOM, with no network.
  new Function('window', 'document', 'parent', 'ResizeObserver', script)(
    window,
    document,
    window,
    undefined,
  );
});
afterEach(() => {
  for (const listener of listeners) window.removeEventListener('message', listener);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  delete document.documentElement.dataset.theme;
});
describe('MCP card widget', () => {
  it('acknowledges host teardown without changing data', () => {
    host({ id: 42, method: 'ui/resource-teardown', params: {} });
    expect(window.postMessage).toHaveBeenCalledWith({ jsonrpc: '2.0', id: 42, result: {} }, '*');
  });

  it('uses compact rows for five or more cards while keeping descriptions in Details', () => {
    result({
      structuredContent: {
        ...data,
        view: 'list',
        cards: Array.from({ length: 5 }, (_, index) => ({ ...data.cards[0], id: String(index) })),
        total: 5,
      },
    });
    expect(document.getElementById('cards')).toHaveClass('compact');
    expect(document.querySelectorAll('article')).toHaveLength(5);
    expect(document.querySelector('details')).toHaveTextContent('First line');
    result({ structuredContent: data });
    expect(document.getElementById('cards')).not.toHaveClass('compact');
  });

  it('renders note content as text, hides technical details and opens only Wally links via the host', async () => {
    expect(window.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'ui/initialize' }),
      '*',
    );
    host({ id: 1, result: { hostContext: { theme: 'dark' } } });
    await Promise.resolve();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'ui/notifications/initialized' }),
      '*',
    );
    result({ structuredContent: data });
    expect(document.querySelector('h2')).toHaveTextContent(data.cards[0]!.title);
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('details')).not.toHaveAttribute('open');
    expect(document.body).toHaveTextContent('1/2 subtasks');
    document.querySelector('a')!.click();
    expect(window.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'ui/open-link', params: { url: data.cards[0]!.url } }),
      '*',
    );
  });
  it('shows lists, empty states and pagination without silently dropping cards', () => {
    result({
      structuredContent: {
        ...data,
        view: 'list',
        cards: [...data.cards, { ...data.cards[0], id: 'two', title: 'Second card' }],
        total: 3,
        nextCursor: 'next',
      },
    });
    expect(document.querySelectorAll('article')).toHaveLength(2);
    expect(document.getElementById('count')).toHaveTextContent('2 of 3 cards');
    expect(document.getElementById('pagination')).not.toHaveAttribute('hidden');
    result({ structuredContent: { ...data, view: 'list', cards: [], total: 0 } });
    expect(document.querySelectorAll('article')).toHaveLength(0);
    expect(document.getElementById('message')).toHaveTextContent('No cards match');
  });
  it('ignores foreign frames and unsafe links and clears stale content on errors', () => {
    host(
      { method: 'ui/notifications/tool-result', params: { structuredContent: data } },
      null as unknown as MessageEventSource,
    );
    expect(document.querySelectorAll('article')).toHaveLength(0);
    result({
      structuredContent: { ...data, cards: [{ ...data.cards[0], url: 'javascript:alert(1)' }] },
    });
    expect(document.querySelector('a')).toBeNull();
    result({ isError: true });
    expect(document.querySelectorAll('article')).toHaveLength(0);
    expect(document.getElementById('board')).toHaveTextContent('Your cards');
    expect(document.getElementById('message')).toHaveTextContent('could not be loaded');
  });
});
