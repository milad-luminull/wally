import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { makeMember } from '@/test/fixtures';
import { ShareSheet } from './ShareSheet';

vi.mock('@/lib/resources', () => ({
  membersApi: { list: vi.fn(), invite: vi.fn(), updateRole: vi.fn(), remove: vi.fn() },
  shareLinkApi: { get: vi.fn(), createOrUpdate: vi.fn() },
}));

import { membersApi, shareLinkApi } from '@/lib/resources';

const owner = makeMember({ id: 'm-owner', userId: 'user-1', email: 'max.berger@finlex.de', displayName: 'Max Berger' });

// Asserted against directly rather than re-reading `navigator.clipboard.writeText` at
// assertion time — kept as our own reference so a later re-stub can't change what the
// assertion resolves to underneath it.
let clipboardWriteText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.mocked(membersApi.list).mockResolvedValue([owner]);
  vi.mocked(shareLinkApi.get).mockResolvedValue({ token: 'tok', role: 'VIEW', url: 'https://hub.finlex.de/w/tok' });
  vi.mocked(shareLinkApi.createOrUpdate).mockResolvedValue({ token: 'tok', role: 'VIEW', url: 'https://hub.finlex.de/w/tok' });
});

async function openShareSheet() {
  const user = userEvent.setup();
  // `userEvent.setup()` installs its own clipboard shim (for its copy()/paste() APIs),
  // which replaces whatever `navigator.clipboard` held before it ran — so our stub has to
  // be defined AFTER setup(), not in a beforeEach, or setup() silently clobbers it.
  // jsdom's Navigator.prototype defines `clipboard` as a getter with no setter, so a plain
  // `navigator.clipboard = ...` / `Object.assign(navigator, {...})` throws; defineProperty
  // with `configurable: true` replaces it for the duration of the test.
  clipboardWriteText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: clipboardWriteText },
    configurable: true,
  });

  renderWithProviders(<ShareSheet boardId="board-1" ownerId="user-1" isOwner isBelowTablet={false} />);
  await user.click(screen.getByRole('button', { name: 'Teilen' }));
  await screen.findByText('https://hub.finlex.de/w/tok');
  return user;
}

describe('ShareSheet', () => {
  it('rejects an invalid email address without calling the invite mutation', async () => {
    const user = await openShareSheet();
    const input = screen.getByLabelText('E-Mail-Adresse einladen');
    await user.type(input, 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Einladen' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ungültige E-Mail-Adresse');
    expect(membersApi.invite).not.toHaveBeenCalled();
  });

  it('shows an optimistic PENDING row immediately on a valid invite submit', async () => {
    let resolveInvite!: (value: Awaited<ReturnType<typeof membersApi.invite>>) => void;
    vi.mocked(membersApi.invite).mockReturnValue(new Promise((resolve) => (resolveInvite = resolve)));

    const user = await openShareSheet();
    await user.type(screen.getByLabelText('E-Mail-Adresse einladen'), 'irem.yildiz@finlex.de');
    await user.click(screen.getByRole('button', { name: 'Einladen' }));

    expect(await screen.findByText('irem.yildiz@finlex.de')).toBeInTheDocument();
    expect(screen.getByText('Ausstehend')).toBeInTheDocument();

    resolveInvite(makeMember({ id: 'm-new', email: 'irem.yildiz@finlex.de', displayName: null, status: 'PENDING' }));
    await waitFor(() => expect(membersApi.invite).toHaveBeenCalledTimes(1));
  });

  it(
    'flips "Kopieren" to "Kopiert" and back after the revert delay',
    async () => {
      // Real timers throughout — mixing vi.useFakeTimers() with Radix's Popover (open)
      // and userEvent's own internals proved unreliable (intermittent hangs with no
      // clear single cause). A real 2.1s wait is slower but dependable; this test's
      // extended per-test timeout below accounts for that plus this environment's
      // already-observed slow first render (~8s for openShareSheet() alone).
      const user = await openShareSheet();

      const copyButton = screen.getByRole('button', { name: 'Kopieren' });
      await user.click(copyButton);

      await waitFor(() => expect(screen.getByRole('button', { name: 'Kopiert' })).toBeInTheDocument());
      expect(clipboardWriteText).toHaveBeenCalledWith('https://hub.finlex.de/w/tok');

      // The component's own revert setTimeout fires and calls setState while this raw
      // wait is in flight, outside any RTL-wrapped interaction — act() here keeps React
      // from warning about that state update happening "outside of a test".
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 2100));
      });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Kopieren' })).toBeInTheDocument());
    },
    { timeout: 20000 },
  );
});
