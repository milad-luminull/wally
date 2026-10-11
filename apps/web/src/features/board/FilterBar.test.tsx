import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BoardViewState } from './hooks/useBoardViewState';
import { FilterBar } from './FilterBar';

function baseView(overrides: Partial<BoardViewState> = {}): BoardViewState {
  return {
    view: 'wand',
    axis: 'horizon',
    q: '',
    priority: [],
    mine: false,
    done: true,
    fieldKey: null,
    fieldValue: null,
    noteId: null,
    ...overrides,
  };
}

describe('FilterBar', () => {
  it('debounces the search input before calling setQuery', async () => {
    const setQuery = vi.fn();
    render(
      <FilterBar
        view={baseView()}
        setQuery={setQuery}
        setPriority={vi.fn()}
        setMine={vi.fn()}
        setDone={vi.fn()}
        setFieldKey={vi.fn()}
        setFieldValue={vi.fn()}
        fieldKeys={[]}
        fieldValues={[]}
        isBelowTablet={false}
      />,
    );

    const input = screen.getByLabelText('Notizen durchsuchen');
    await userEvent.type(input, 'cyber');

    // Not called synchronously with every keystroke.
    expect(setQuery).not.toHaveBeenCalledWith('c');
    await waitFor(() => expect(setQuery).toHaveBeenCalledWith('cyber'), { timeout: 1000 });
    expect(setQuery).toHaveBeenCalledTimes(1);
  });

  it('lets multiple priority chips be selected at once', async () => {
    const setPriority = vi.fn();
    const { rerender } = render(
      <FilterBar
        view={baseView()}
        setQuery={vi.fn()}
        setPriority={setPriority}
        setMine={vi.fn()}
        setDone={vi.fn()}
        setFieldKey={vi.fn()}
        setFieldValue={vi.fn()}
        fieldKeys={[]}
        fieldValues={[]}
        isBelowTablet={false}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Nach Priorität Hoch filtern' }));
    expect(setPriority).toHaveBeenCalledWith(['HOCH']);

    rerender(
      <FilterBar
        view={baseView({ priority: ['HOCH'] })}
        setQuery={vi.fn()}
        setPriority={setPriority}
        setMine={vi.fn()}
        setDone={vi.fn()}
        setFieldKey={vi.fn()}
        setFieldValue={vi.fn()}
        fieldKeys={[]}
        fieldValues={[]}
        isBelowTablet={false}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Nach Priorität Mittel filtern' }));
    expect(setPriority).toHaveBeenCalledWith(['HOCH', 'MITTEL']);
  });

  it('toggles "Nur meine" and "Erledigte"', async () => {
    const setMine = vi.fn();
    const setDone = vi.fn();
    render(
      <FilterBar
        view={baseView()}
        setQuery={vi.fn()}
        setPriority={vi.fn()}
        setMine={setMine}
        setDone={setDone}
        setFieldKey={vi.fn()}
        setFieldValue={vi.fn()}
        fieldKeys={[]}
        fieldValues={[]}
        isBelowTablet={false}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Nur meine' }));
    expect(setMine).toHaveBeenCalledWith(true);

    await userEvent.click(screen.getByRole('button', { name: 'Erledigte ausblenden' }));
    expect(setDone).toHaveBeenCalledWith(false);
  });

  it('collapses filters into a single Filter button below 720px', () => {
    render(
      <FilterBar
        view={baseView()}
        setQuery={vi.fn()}
        setPriority={vi.fn()}
        setMine={vi.fn()}
        setDone={vi.fn()}
        setFieldKey={vi.fn()}
        setFieldValue={vi.fn()}
        fieldKeys={[]}
        fieldValues={[]}
        isBelowTablet
      />,
    );
    expect(screen.getByRole('button', { name: /Filter/ })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Nach Priorität Hoch filtern' }),
    ).not.toBeInTheDocument();
  });
});
