import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { makeNote } from '@/test/fixtures';
import { RelatedNotes } from './RelatedNotes';
const a = makeNote({ id: 'a', title: 'Source', links: ['b', 'missing'] });
const notes = [
  a,
  makeNote({ id: 'b', title: 'Outgoing' }),
  makeNote({ id: 'c', title: 'Incoming', links: ['a'] }),
  makeNote({ id: 'd', title: 'Candidate' }),
  makeNote({ id: 'e', title: 'Done', status: 'DONE' }),
];
function setup(disabled = false) {
  const props = { note: a, notes, disabled, onOpen: vi.fn(), onAdd: vi.fn(), onRemove: vi.fn() };
  renderWithProviders(<RelatedNotes {...props} />);
  return props;
}
describe('RelatedNotes', () => {
  it('opens either direction and removes only an outgoing link', async () => {
    const props = setup();
    await userEvent.click(screen.getByTitle('Linked from Incoming'));
    expect(props.onOpen).toHaveBeenCalledWith('c');
    await userEvent.click(screen.getByRole('button', { name: 'Remove the link to Outgoing' }));
    expect(props.onRemove).toHaveBeenCalledWith('b');
    expect(
      screen.queryByRole('button', { name: 'Remove the link to Incoming' }),
    ).not.toBeInTheDocument();
  });
  it('offers only unlinked open notes and searches by title', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Link a note…' }));
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await userEvent.type(screen.getByRole('combobox', { name: 'Search notes' }), 'wrong');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    await userEvent.clear(screen.getByRole('combobox', { name: 'Search notes' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Search notes' }), 'Candidate');
    await userEvent.click(screen.getByRole('option', { name: 'Candidate' }));
    expect(props.onAdd).toHaveBeenCalledWith('d');
  });
  it('shows relations without edit controls to a read-only viewer', () => {
    setup(true);
    expect(screen.getByTitle('Linked to Outgoing')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Link a note…' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove the link/ })).not.toBeInTheDocument();
  });
});
