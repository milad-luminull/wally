import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AssistantConversationDto } from '@wally/shared';

vi.mock('@/lib/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/resources')>()),
  assistantApi: { latest: vi.fn(), turn: vi.fn() },
  notesApi: { list: vi.fn().mockResolvedValue([]) },
}));

import { ApiError } from '@/lib/apiClient';
import { assistantApi, notesApi } from '@/lib/resources';
import { renderWithProviders } from '@/test/renderWithProviders';
import { makeNote } from '@/test/fixtures';
import { AssistantContent } from './AssistantContent';

const entry = (
  role: 'user' | 'assistant',
  text: string,
  extra: Partial<AssistantConversationDto['entries'][number]> = {},
) => ({
  role,
  text,
  chips: [],
  partial: false,
  stopped: null,
  at: '2026-10-15T10:00:00.000Z',
  ...extra,
});
const conversation = (
  entries: AssistantConversationDto['entries'],
  id = 'c1',
): AssistantConversationDto => ({
  id,
  boardId: 'b1',
  status: 'OPEN',
  model: 'm',
  entries,
});

function renderContent(overrides: Partial<Parameters<typeof AssistantContent>[0]> = {}) {
  const onOpenNote = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(
    <AssistantContent
      boardId="b1"
      onClose={onClose}
      onOpenNote={onOpenNote}
      autoFocus={false}
      {...overrides}
    />,
  );
  return { onOpenNote, onClose };
}

describe('AssistantContent', () => {
  beforeEach(() => {
    vi.mocked(assistantApi.latest)
      .mockReset()
      .mockRejectedValue(new ApiError(404, { error: 'NOT_FOUND' }));
    vi.mocked(assistantApi.turn).mockReset();
    vi.mocked(notesApi.list).mockResolvedValue([]);
  });

  it('shows the field and three example questions when there is no conversation', async () => {
    renderContent();
    expect(await screen.findByPlaceholderText('What is open today?')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'What is overdue?' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Who has the most open notes?' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Earlier')).not.toBeInTheDocument();
  });

  it('asks on Enter, keeps the question on screen while loading, then shows the answer with the notes read', async () => {
    const note = makeNote({ id: 'n1', title: 'Müller anrufen', dueDate: null });
    vi.mocked(notesApi.list).mockResolvedValue([note]);
    let release: (v: { conversation: AssistantConversationDto }) => void = () => {};
    vi.mocked(assistantApi.turn).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const { onOpenNote } = renderContent();
    const user = userEvent.setup();
    const field = await screen.findByPlaceholderText('What is open today?');
    await user.type(field, 'Was ist offen?{Enter}');
    expect(screen.getByText('Was ist offen?', { selector: 'p' })).toBeInTheDocument();
    expect(field).toBeDisabled();
    release({
      conversation: conversation([
        entry('user', 'Was ist offen?'),
        entry('assistant', 'Eine Notiz: Müller anrufen.', {
          chips: [{ id: 'n1', title: 'Müller anrufen' }],
        }),
      ]),
    });
    expect(await screen.findByText('Eine Notiz: Müller anrufen.')).toBeInTheDocument();
    expect(screen.getByText('Notes read')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Müller anrufen/ }));
    expect(onOpenNote).toHaveBeenCalledWith('n1');
    expect(field).not.toBeDisabled();
    expect(field).toHaveValue('');
  });

  it('inserts a line break on Shift+Enter and never sends an empty question', async () => {
    renderContent();
    const user = userEvent.setup();
    const field = await screen.findByPlaceholderText('What is open today?');
    await user.type(field, 'a{Shift>}{Enter}{/Shift}b');
    expect(field).toHaveValue('a\nb');
    expect(assistantApi.turn).not.toHaveBeenCalled();
    await user.clear(field);
    await user.type(field, '   {Enter}');
    expect(assistantApi.turn).not.toHaveBeenCalled();
  });

  it('asks an example question on click', async () => {
    vi.mocked(assistantApi.turn).mockResolvedValue({
      conversation: conversation([
        entry('user', 'What is overdue?'),
        entry('assistant', 'Nichts.'),
      ]),
    });
    renderContent();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'What is overdue?' }));
    expect(await screen.findByText('Nichts.')).toBeInTheDocument();
    expect(vi.mocked(assistantApi.turn).mock.calls[0]![1]).toMatchObject({
      message: 'What is overdue?',
    });
  });

  it('shows the newest exchange first and the rest under "Earlier"', async () => {
    vi.mocked(assistantApi.latest).mockResolvedValue(
      conversation([
        entry('user', 'eins'),
        entry('assistant', 'Antwort eins'),
        entry('user', 'zwei'),
        entry('assistant', 'Antwort zwei'),
      ]),
    );
    renderContent();
    expect(await screen.findByText('Antwort zwei')).toBeInTheDocument();
    const texts = screen.getAllByText(/Antwort (eins|zwei)/).map((el) => el.textContent);
    expect(texts).toEqual(['Antwort zwei', 'Antwort eins']);
    expect(screen.getByText('Earlier')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
    // Restored on open, so nothing is announced; only an answer asked for here is.
    expect(screen.getByText('Antwort zwei').closest('[aria-live]')).toBeNull();
  });

  it('renders a cap refusal in the answer slot with the reset time, and keeps the question', async () => {
    vi.mocked(assistantApi.turn).mockRejectedValue(
      new ApiError(429, {
        error: 'ASSISTANT_DAILY_CAP',
        message: 'x',
        resetsAt: '2026-10-16T00:00:00.000Z',
      }),
    );
    renderContent();
    const user = userEvent.setup();
    await user.type(await screen.findByPlaceholderText('What is open today?'), 'eins{Enter}');
    expect(
      await screen.findByText(/Daily limit reached\. Available again from .+\./),
    ).toBeInTheDocument();
    expect(screen.getByText('eins', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('What is open today?')).toHaveValue('eins');
  });

  it('empties the field while the turn runs and puts the question back when the ask fails', async () => {
    let fail: (reason: unknown) => void = () => {};
    vi.mocked(assistantApi.turn).mockReturnValueOnce(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    renderContent();
    const user = userEvent.setup();
    const field = await screen.findByPlaceholderText('What is open today?');
    await user.type(field, 'Was ist offen?{Enter}');
    // Pending: the question is shown once, above the skeleton, and the field is empty.
    expect(field).toHaveValue('');
    expect(field).toBeDisabled();
    const question = screen.getByText('Was ist offen?', { selector: 'p' });
    expect(question.nextElementSibling?.querySelector('.wally-skeleton')).not.toBeNull();
    await act(async () => {
      fail(new ApiError(500, { error: 'INTERNAL_SERVER_ERROR' }));
    });
    expect(await screen.findByText('No answer. Try again.')).toBeInTheDocument();
    expect(field).toHaveValue('Was ist offen?');
  });

  it('caps the field at the length the API accepts', async () => {
    renderContent();
    expect(await screen.findByPlaceholderText('What is open today?')).toHaveAttribute(
      'maxLength',
      '2000',
    );
  });

  it('renders stopped and partial answers with their one line', async () => {
    vi.mocked(assistantApi.latest).mockResolvedValue(
      conversation([
        entry('user', 'alles'),
        entry('assistant', 'Viele.', { partial: true }),
        entry('user', 'zu viel'),
        entry('assistant', '', { stopped: 'TOOL_LIMIT' }),
      ]),
    );
    renderContent();
    expect(await screen.findByText(/Stopped after twelve reads/)).toBeInTheDocument();
    expect(screen.getByText('Only part of the matching notes was read.')).toBeInTheDocument();
  });

  it('starts a fresh conversation on "New"', async () => {
    vi.mocked(assistantApi.latest).mockResolvedValue(
      conversation([entry('user', 'eins'), entry('assistant', 'Antwort eins')]),
    );
    vi.mocked(assistantApi.turn).mockResolvedValue({
      conversation: conversation([entry('user', 'zwei'), entry('assistant', 'Antwort zwei')], 'c2'),
    });
    renderContent();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New' }));
    await waitFor(() => expect(screen.queryByText('Antwort eins')).not.toBeInTheDocument());
    await user.type(screen.getByPlaceholderText('What is open today?'), 'zwei{Enter}');
    expect(await screen.findByText('Antwort zwei')).toBeInTheDocument();
    expect(vi.mocked(assistantApi.turn).mock.calls[0]![1]).not.toHaveProperty('conversationId');
  });
  it('gives focus back to the field when the turn settles and announces the answer politely', async () => {
    let release: (v: { conversation: AssistantConversationDto }) => void = () => {};
    vi.mocked(assistantApi.turn).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    renderContent();
    const user = userEvent.setup();
    const field = await screen.findByPlaceholderText('What is open today?');
    await user.type(field, 'eins{Enter}');
    const region = screen.getByText('eins', { selector: 'p' }).closest('[aria-live]');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-busy', 'true');
    // A real browser drops focus from a disabled field to the body; jsdom keeps it there and
    // ignores blur() on a disabled element, so focus a throwaway element and remove it.
    act(() => {
      const spare = document.body.appendChild(document.createElement('button'));
      spare.focus();
      spare.remove();
    });
    expect(document.activeElement).toBe(document.body);
    release({
      conversation: conversation([entry('user', 'eins'), entry('assistant', 'Antwort eins')]),
    });
    const answer = await screen.findByText('Antwort eins');
    expect(answer.closest('[aria-live]')).toBe(region);
    expect(region).toHaveAttribute('aria-busy', 'false');
    await waitFor(() => expect(field).toHaveFocus());
  });

  it('leaves focus where the person put it while the turn ran', async () => {
    let release: (v: { conversation: AssistantConversationDto }) => void = () => {};
    vi.mocked(assistantApi.turn).mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    renderContent();
    const user = userEvent.setup();
    await user.type(await screen.findByPlaceholderText('What is open today?'), 'eins{Enter}');
    const close = screen.getByRole('button', { name: 'Close' });
    act(() => close.focus());
    release({
      conversation: conversation([entry('user', 'eins'), entry('assistant', 'Antwort eins')]),
    });
    expect(await screen.findByText('Antwort eins')).toBeInTheDocument();
    expect(close).toHaveFocus();
  });

  it('shows earlier exchanges unfaded, in the same colour as the latest', async () => {
    vi.mocked(assistantApi.latest).mockResolvedValue(
      conversation([
        entry('user', 'eins'),
        entry('assistant', 'Antwort eins'),
        entry('user', 'zwei'),
        entry('assistant', 'Antwort zwei'),
      ]),
    );
    renderContent();
    const older = await screen.findByText('Antwort eins');
    for (let el: HTMLElement | null = older; el; el = el.parentElement) {
      expect(el.className).not.toMatch(/opacity-/);
    }
    expect(older.className).toBe(screen.getByText('Antwort zwei').className);
  });

  it('shows only the new conversation when the open one closed under the panel (409)', async () => {
    vi.mocked(assistantApi.latest).mockResolvedValue(
      conversation([entry('user', 'eins'), entry('assistant', 'Antwort eins')]),
    );
    vi.mocked(assistantApi.turn)
      .mockRejectedValueOnce(new ApiError(409, { error: 'ASSISTANT_CONVERSATION_CLOSED' }))
      .mockResolvedValueOnce({
        conversation: conversation(
          [entry('user', 'zwei'), entry('assistant', 'Antwort zwei')],
          'c2',
        ),
      });
    renderContent();
    const user = userEvent.setup();
    await screen.findByText('Antwort eins');
    await user.type(screen.getByPlaceholderText('What is open today?'), 'zwei{Enter}');
    expect(await screen.findByText('Antwort zwei')).toBeInTheDocument();
    expect(screen.queryByText('Antwort eins')).not.toBeInTheDocument();
    expect(screen.queryByText('Earlier')).not.toBeInTheDocument();
    expect(vi.mocked(assistantApi.turn).mock.calls[0]![1]).toMatchObject({ conversationId: 'c1' });
    expect(vi.mocked(assistantApi.turn).mock.calls[1]![1]).not.toHaveProperty('conversationId');
  });

  it('never shows the dismissed conversation again after "New" and an answer', async () => {
    vi.mocked(assistantApi.latest).mockResolvedValue(
      conversation([entry('user', 'eins'), entry('assistant', 'Antwort eins')]),
    );
    vi.mocked(assistantApi.turn).mockResolvedValue({
      conversation: conversation([entry('user', 'zwei'), entry('assistant', 'Antwort zwei')], 'c2'),
    });
    renderContent();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'New' }));
    await waitFor(() => expect(screen.queryByText('Antwort eins')).not.toBeInTheDocument());
    // Every DOM change from here on is checked, so a single intermediate commit that
    // re-renders the old conversation fails the test even if a later one removes it.
    let flashed = false;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const nodes = [record.target, ...Array.from(record.addedNodes)];
        if (nodes.some((node) => node.textContent?.includes('Antwort eins'))) flashed = true;
      }
      if (document.body.textContent?.includes('Antwort eins')) flashed = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    await user.type(screen.getByPlaceholderText('What is open today?'), 'zwei{Enter}');
    expect(await screen.findByText('Antwort zwei')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 20));
    observer.disconnect();
    expect(flashed).toBe(false);
  });
  it('names the field apart from the title and the ask button', async () => {
    renderContent();
    expect(
      await screen.findByRole('textbox', { name: 'Question for the wall' }),
    ).toBeInTheDocument();
  });

  it('shows the empty state for a conversation with no entries and continues it on the next ask', async () => {
    vi.mocked(assistantApi.latest).mockResolvedValue(conversation([], 'c-empty'));
    vi.mocked(assistantApi.turn).mockResolvedValue({
      conversation: conversation(
        [entry('user', 'What is overdue?'), entry('assistant', 'Nichts.')],
        'c-empty',
      ),
    });
    renderContent();
    const user = userEvent.setup();
    const example = await screen.findByRole('button', { name: 'What is overdue?' });
    expect(
      screen.getByRole('button', { name: 'Who has the most open notes?' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'What is open today?' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New' })).not.toBeInTheDocument();
    await user.click(example);
    expect(await screen.findByText('Nichts.')).toBeInTheDocument();
    expect(vi.mocked(assistantApi.turn).mock.calls[0]![1]).toMatchObject({
      message: 'What is overdue?',
      conversationId: 'c-empty',
    });
  });

  it('shows no example questions while the latest conversation is still loading', async () => {
    vi.mocked(assistantApi.latest).mockReturnValue(new Promise(() => {}));
    renderContent();
    await screen.findByPlaceholderText('What is open today?');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('button', { name: 'What is overdue?' })).not.toBeInTheDocument();
  });

  it('keeps "New" after a failed ask and hides it only while a turn runs', async () => {
    vi.mocked(assistantApi.latest).mockResolvedValue(
      conversation([entry('user', 'eins'), entry('assistant', 'Antwort eins')]),
    );
    let fail: (error: unknown) => void = () => {};
    vi.mocked(assistantApi.turn).mockReturnValueOnce(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    renderContent();
    const user = userEvent.setup();
    await screen.findByText('Antwort eins');
    await user.type(screen.getByPlaceholderText('What is open today?'), 'zwei{Enter}');
    expect(screen.queryByRole('button', { name: 'New' })).not.toBeInTheDocument();
    act(() => fail(new ApiError(500, { error: 'INTERNAL_SERVER_ERROR' })));
    expect(await screen.findByText('No answer. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
  });

  it('falls back to the busy line when the reset time cannot be read', async () => {
    vi.mocked(assistantApi.turn).mockRejectedValue(
      new ApiError(429, { error: 'ASSISTANT_MONTHLY_CAP', message: 'x', resetsAt: 'bald' }),
    );
    renderContent();
    const user = userEvent.setup();
    await user.type(await screen.findByPlaceholderText('What is open today?'), 'eins{Enter}');
    expect(await screen.findByText('Busy right now. Try again in a moment.')).toBeInTheDocument();
  });

  it('gives the monthly cap a date without a time', async () => {
    vi.mocked(assistantApi.turn).mockRejectedValue(
      new ApiError(429, {
        error: 'ASSISTANT_MONTHLY_CAP',
        message: 'x',
        resetsAt: '2026-11-01T00:00:00.000Z',
      }),
    );
    renderContent();
    const user = userEvent.setup();
    await user.type(await screen.findByPlaceholderText('What is open today?'), 'eins{Enter}');
    const line = await screen.findByText(/Monthly limit reached\. Available again from .+\./);
    expect(line.textContent).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it('does not ask on Enter while an input method is composing', async () => {
    renderContent();
    const field = await screen.findByPlaceholderText('What is open today?');
    fireEvent.change(field, { target: { value: 'にほん' } });
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    expect(assistantApi.turn).not.toHaveBeenCalled();
    expect(field).toHaveValue('にほん');
  });

  it('keeps the line breaks of a question', async () => {
    vi.mocked(assistantApi.latest).mockResolvedValue(
      conversation([entry('user', 'eins\nzwei'), entry('assistant', 'Antwort')]),
    );
    renderContent();
    await screen.findByText('Antwort');
    expect(screen.getByText(/eins\s+zwei/, { selector: 'p' })).toHaveClass('whitespace-pre-line');
  });
});
