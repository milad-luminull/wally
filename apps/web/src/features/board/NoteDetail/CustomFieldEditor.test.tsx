import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomFieldEditor } from './CustomFieldEditor';

// The rows sort in the reader's language, which useLanguage supplies outside a provider here.
const reader = vi.hoisted(() => ({ language: 'en' as 'de' | 'en' }));
vi.mock('@/i18n/LanguageProvider', async () => {
  const actual =
    await vi.importActual<typeof import('@/i18n/LanguageProvider')>('@/i18n/LanguageProvider');
  return {
    ...actual,
    useLanguage: () => ({
      language: reader.language,
      setLanguage: () => {},
      isSaving: false,
      saveFailed: false,
    }),
  };
});

afterEach(() => {
  reader.language = 'en';
  vi.restoreAllMocks();
});

describe('CustomFieldEditor', () => {
  it('commits a key/value pair on Enter and clears both inputs', async () => {
    const onSet = vi.fn();
    render(<CustomFieldEditor fields={{}} onSet={onSet} onRemove={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Field name'), 'Customer');
    await userEvent.type(screen.getByLabelText('Field value'), 'Müller GmbH{Enter}');

    expect(onSet).toHaveBeenCalledWith('Customer', 'Müller GmbH');
    expect(screen.getByLabelText('Field name')).toHaveValue('');
    expect(screen.getByLabelText('Field value')).toHaveValue('');
  });

  it('does not commit when only one of the two inputs is filled', async () => {
    const onSet = vi.fn();
    render(<CustomFieldEditor fields={{}} onSet={onSet} onRemove={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('Field name'), 'Customer{Enter}');
    expect(onSet).not.toHaveBeenCalled();
  });

  it('reuses the stored spelling when a key is retyped in a different case', async () => {
    const onSet = vi.fn();
    render(
      <CustomFieldEditor fields={{ Customer: 'Müller GmbH' }} onSet={onSet} onRemove={vi.fn()} />,
    );

    await userEvent.type(screen.getByLabelText('Field name'), 'customer');
    await userEvent.type(screen.getByLabelText('Field value'), 'Steiner AG{Enter}');

    expect(onSet).toHaveBeenCalledWith('Customer', 'Steiner AG');
  });

  it('sorts rows by key and removes on the per-row button', async () => {
    const onRemove = vi.fn();
    render(
      <CustomFieldEditor
        fields={{ Reference: '4711', Customer: 'Müller GmbH' }}
        onSet={vi.fn()}
        onRemove={onRemove}
      />,
    );

    const rendered = screen.getAllByText(/^(Customer|Reference)$/).map((el) => el.textContent);
    expect(rendered).toEqual(['Customer', 'Reference']);

    await userEvent.click(screen.getByLabelText('Remove Customer'));
    expect(onRemove).toHaveBeenCalledWith('Customer');
  });

  it.each(['de', 'en'] as const)(
    'sorts rows for a reader of %s: Ärger before Zebra',
    (language) => {
      reader.language = language;
      const compare = vi.spyOn(String.prototype, 'localeCompare');
      render(
        <CustomFieldEditor
          fields={{ Zebra: '1', Ärger: '2' }}
          onSet={vi.fn()}
          onRemove={vi.fn()}
        />,
      );

      // A code-point sort would put Zebra first (Z is U+005A, Ä is U+00C4).
      const rendered = screen.getAllByText(/^(Ärger|Zebra)$/).map((el) => el.textContent);
      expect(rendered).toEqual(['Ärger', 'Zebra']);
      expect(compare.mock.calls.map(([, locale]) => locale)).toContain(language);
    },
  );

  it('hides the inputs and remove buttons when disabled', () => {
    render(
      <CustomFieldEditor
        fields={{ Customer: 'Müller GmbH' }}
        onSet={vi.fn()}
        onRemove={vi.fn()}
        disabled
      />,
    );

    expect(screen.queryByLabelText('Field name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Remove Customer')).not.toBeInTheDocument();
    // The values themselves stay readable.
    expect(screen.getByText('Müller GmbH')).toBeInTheDocument();
  });
});
