import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SubtaskDto } from '@wally/shared';
import { SubtaskChecklist } from './SubtaskChecklist';

function makeSubtask(overrides: Partial<SubtaskDto> = {}): SubtaskDto {
  return {
    id: 's1',
    noteId: 'n1',
    text: 'Check the cover amounts',
    done: false,
    sortIndex: 0,
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('SubtaskChecklist', () => {
  it('shows the "done of total" header once there are subtasks', () => {
    render(
      <SubtaskChecklist
        subtasks={[makeSubtask({ done: true }), makeSubtask({ id: 's2', done: false })]}
        onAdd={vi.fn()}
        onToggle={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('1 of 2')).toBeInTheDocument();
  });

  it('toggles a subtask via its checkbox', async () => {
    const onToggle = vi.fn();
    render(
      <SubtaskChecklist
        subtasks={[makeSubtask({ done: false })]}
        onAdd={vi.fn()}
        onToggle={onToggle}
        onRemove={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('checkbox', { name: /Mark .+ as done/i }));
    expect(onToggle).toHaveBeenCalledWith('s1', true);
  });

  it('removes a subtask', async () => {
    const onRemove = vi.fn();
    render(
      <SubtaskChecklist
        subtasks={[makeSubtask()]}
        onAdd={vi.fn()}
        onToggle={vi.fn()}
        onRemove={onRemove}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Remove/i }));
    expect(onRemove).toHaveBeenCalledWith('s1');
  });

  it('adds a new subtask on Enter', async () => {
    const onAdd = vi.fn();
    render(<SubtaskChecklist subtasks={[]} onAdd={onAdd} onToggle={vi.fn()} onRemove={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Add subtask'), 'Send the comparison{Enter}');
    expect(onAdd).toHaveBeenCalledWith('Send the comparison');
  });

  it('renders no interactive controls when disabled', () => {
    render(
      <SubtaskChecklist
        subtasks={[makeSubtask()]}
        onAdd={vi.fn()}
        onToggle={vi.fn()}
        onRemove={vi.fn()}
        disabled
      />,
    );
    expect(screen.queryByLabelText('Add subtask')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/i })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });
});
