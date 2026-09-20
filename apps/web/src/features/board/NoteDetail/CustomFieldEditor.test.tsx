import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomFieldEditor } from './CustomFieldEditor';

describe('CustomFieldEditor', () => {
  it('commits a key/value pair on Enter and clears both inputs', async () => {
    const onSet = vi.fn();
    render(<CustomFieldEditor fields={{}} onSet={onSet} onRemove={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Feldname'), 'Kunde');
    await userEvent.type(screen.getByLabelText('Feldwert'), 'Müller GmbH{Enter}');

    expect(onSet).toHaveBeenCalledWith('Kunde', 'Müller GmbH');
    expect(screen.getByLabelText('Feldname')).toHaveValue('');
    expect(screen.getByLabelText('Feldwert')).toHaveValue('');
  });

  it('does not commit when only one of the two inputs is filled', async () => {
    const onSet = vi.fn();
    render(<CustomFieldEditor fields={{}} onSet={onSet} onRemove={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Feldname'), 'Kunde{Enter}');
    expect(onSet).not.toHaveBeenCalled();
  });

  it('reuses the stored spelling when a key is retyped in a different case', async () => {
    const onSet = vi.fn();
    render(
      <CustomFieldEditor fields={{ Kunde: 'Müller GmbH' }} onSet={onSet} onRemove={vi.fn()} />,
    );

    await userEvent.type(screen.getByLabelText('Feldname'), 'kunde');
    await userEvent.type(screen.getByLabelText('Feldwert'), 'Steiner AG{Enter}');

    expect(onSet).toHaveBeenCalledWith('Kunde', 'Steiner AG');
  });

  it('sorts rows by key and removes on the per-row button', async () => {
    const onRemove = vi.fn();
    render(
      <CustomFieldEditor
        fields={{ Vertragsnr: '4711', Kunde: 'Müller GmbH' }}
        onSet={vi.fn()}
        onRemove={onRemove}
      />,
    );

    const rendered = screen.getAllByText(/^(Kunde|Vertragsnr)$/).map((el) => el.textContent);
    expect(rendered).toEqual(['Kunde', 'Vertragsnr']);

    await userEvent.click(screen.getByLabelText('Kunde entfernen'));
    expect(onRemove).toHaveBeenCalledWith('Kunde');
  });

  it('hides the inputs and remove buttons when disabled', () => {
    render(
      <CustomFieldEditor
        fields={{ Kunde: 'Müller GmbH' }}
        onSet={vi.fn()}
        onRemove={vi.fn()}
        disabled
      />,
    );

    expect(screen.queryByLabelText('Feldname')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Kunde entfernen')).not.toBeInTheDocument();
    // The values themselves stay readable.
    expect(screen.getByText('Müller GmbH')).toBeInTheDocument();
  });
});
