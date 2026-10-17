import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { makeNote } from '@/test/fixtures';
import { AnswerNotes } from './AnswerNotes';

const chips = [
  { id: 'n1', title: 'Müller anrufen' },
  { id: 'n2', title: 'Angebot schicken' },
];

describe('AnswerNotes', () => {
  it('drops a chip whose note is no longer on the board once the notes have loaded', () => {
    renderWithProviders(
      <AnswerNotes
        chips={chips}
        notes={[makeNote({ id: 'n1', title: 'Müller anrufen' })]}
        onOpenNote={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Müller anrufen/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Angebot schicken/ })).not.toBeInTheDocument();
  });

  it('keeps every chip while the notes are still loading', () => {
    renderWithProviders(<AnswerNotes chips={chips} notes={undefined} onOpenNote={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Müller anrufen/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Angebot schicken/ })).toBeInTheDocument();
  });

  it('shows the untitled label for a chip without a title', () => {
    renderWithProviders(
      <AnswerNotes chips={[{ id: 'n3', title: '' }]} notes={undefined} onOpenNote={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Untitled' })).toBeInTheDocument();
  });

  it('shows nothing when none of the notes read are left', () => {
    renderWithProviders(<AnswerNotes chips={chips} notes={[]} onOpenNote={vi.fn()} />);
    expect(screen.queryByText('Notes read')).not.toBeInTheDocument();
  });
});
