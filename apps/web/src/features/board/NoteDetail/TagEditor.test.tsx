import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TagEditor } from './TagEditor';

describe('TagEditor', () => {
  it('renders existing tags and lets you remove one', async () => {
    const onRemove = vi.fn();
    render(<TagEditor tags={['Smart Tender', 'Cyber']} onAdd={vi.fn()} onRemove={onRemove} />);

    expect(screen.getByText('Smart Tender')).toBeInTheDocument();
    expect(screen.getByText('Cyber')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remove Cyber' }));
    expect(onRemove).toHaveBeenCalledWith('Cyber');
  });

  it('adds a tag on Enter and clears the draft input', async () => {
    const onAdd = vi.fn();
    render(<TagEditor tags={[]} onAdd={onAdd} onRemove={vi.fn()} />);

    const input = screen.getByLabelText('Add tag');
    await userEvent.type(input, 'Easy Renewal{Enter}');

    expect(onAdd).toHaveBeenCalledWith('Easy Renewal');
    expect(input).toHaveValue('');
  });

  it('does not add an empty or duplicate tag', async () => {
    const onAdd = vi.fn();
    render(<TagEditor tags={['Cyber']} onAdd={onAdd} onRemove={vi.fn()} />);

    const input = screen.getByLabelText('Add tag');
    await userEvent.type(input, '{Enter}');
    await userEvent.type(input, 'Cyber{Enter}');

    expect(onAdd).not.toHaveBeenCalled();
  });

  it('hides remove buttons and the add input when disabled', () => {
    render(<TagEditor tags={['Cyber']} onAdd={vi.fn()} onRemove={vi.fn()} disabled />);

    expect(screen.queryByLabelText('Add tag')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Cyber' })).not.toBeInTheDocument();
  });
});
