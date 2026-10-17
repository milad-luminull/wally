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

const owner = makeMember({
  id: 'm-owner',
  userId: 'user-1',
  email: 'mika.brandt@example.com',
  displayName: 'Mika Brandt',
});

// Asserted against directly rather than re-reading `navigator.clipboard.writeText` at
// assertion time — kept as our own reference so a later re-stub can't change what the
// assertion resolves to underneath it.
let clipboardWriteText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.mocked(membersApi.list).mockResolvedValue([owner]);
  vi.mocked(shareLinkApi.get).mockResolvedValue({
    token: 'tok',
    role: 'VIEW',
    url: 'https://hub.example.com/w/tok',
  });
  vi.mocked(shareLinkApi.createOrUpdate).mockResolvedValue({
    token: 'tok',
    role: 'VIEW',
    url: 'https://hub.example.com/w/tok',
  });
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

  renderWithProviders(
    <ShareSheet boardId="board-1" ownerId="user-1" isOwner isBelowTablet={false} />,
  );
  await user.click(screen.getByRole('button', { name: 'Share' }));
  await screen.findByText('https://hub.example.com/w/tok');
  return user;
}

describe('ShareSheet', () => {
  it('tells members that private notes stay with their author', async () => {
    await openShareSheet();
    expect(
      screen.getByText('Members can keep private notes that only they can see.'),
    ).toBeInTheDocument();
  });

  it('rejects an invalid email address without calling the invite mutation', async () => {
    const user = await openShareSheet();
    const input = screen.getByLabelText('Invite email address');
    await user.type(input, 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Invite' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email address');
    expect(membersApi.invite).not.toHaveBeenCalled();
  });

  it('shows an optimistic PENDING row immediately on a valid invite submit', async () => {
    let resolveInvite!: (value: Awaited<ReturnType<typeof membersApi.invite>>) => void;
    vi.mocked(membersApi.invite).mockReturnValue(
      new Promise((resolve) => (resolveInvite = resolve)),
    );

    const user = await openShareSheet();
    await user.type(screen.getByLabelText('Invite email address'), 'deniz.kilic@example.com');
    await user.click(screen.getByRole('button', { name: 'Invite' }));

    expect(await screen.findByText('deniz.kilic@example.com')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();

    resolveInvite(
      makeMember({
        id: 'm-new',
        email: 'deniz.kilic@example.com',
        displayName: null,
        status: 'PENDING',
      }),
    );
    await waitFor(() => expect(membersApi.invite).toHaveBeenCalledTimes(1));
  });

  it(
    'flips "Copy" to "Copied" and back after the revert delay',
    async () => {
      // Real timers throughout — mixing vi.useFakeTimers() with Radix's Popover (open)
      // and userEvent's own internals proved unreliable (intermittent hangs with no
      // clear single cause). A real 2.1s wait is slower but dependable; this test's
      // extended per-test timeout below accounts for that plus this environment's
      // already-observed slow first render (~8s for openShareSheet() alone).
      const user = await openShareSheet();

      const copyButton = screen.getByRole('button', { name: 'Copy' });
      await user.click(copyButton);

      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument(),
      );
      expect(clipboardWriteText).toHaveBeenCalledWith('https://hub.example.com/w/tok');

      // The component's own revert setTimeout fires and calls setState while this raw
      // wait is in flight, outside any RTL-wrapped interaction — act() here keeps React
      // from warning about that state update happening "outside of a test".
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 2100));
      });
      await waitFor(() => expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument());
    },
    { timeout: 20000 },
  );
});
