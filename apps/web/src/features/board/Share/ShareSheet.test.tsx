import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/renderWithProviders';
import { makeMember } from '@/test/fixtures';
import { ShareSheet } from './ShareSheet';

vi.mock('@/lib/resources', () => ({
  membersApi: { list: vi.fn(), invite: vi.fn(), updateRole: vi.fn(), remove: vi.fn() },
  shareLinkApi: { get: vi.fn(), createOrUpdate: vi.fn(), remove: vi.fn(), rotate: vi.fn() },
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
  vi.clearAllMocks();
  vi.mocked(membersApi.list).mockResolvedValue([owner]);
  vi.mocked(shareLinkApi.get).mockResolvedValue({
    token: 'tok',
    role: 'VIEW',
    url: 'https://hub.example.com/w/tok',
  });
  vi.mocked(shareLinkApi.createOrUpdate).mockImplementation(async () => {
    const link = {
      token: 'tok',
      url: 'https://hub.example.com/w/tok',
      role: 'VIEW' as const,
    };
    vi.mocked(shareLinkApi.get).mockResolvedValue(link);
    return link;
  });
});

async function openShareSheet(waitForLink = true) {
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
    <ShareSheet
      boardName="Product planning"
      boardId="board-1"
      ownerId="user-1"
      isOwner
      isBelowTablet={false}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Share board' }));
  if (waitForLink) await screen.findByDisplayValue('https://hub.example.com/w/tok');
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
    await user.click(screen.getByRole('button', { name: 'Invite to board' }));

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
    await user.click(screen.getByRole('button', { name: 'Invite to board' }));

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

  it('flips "Copy" to "Copied" and back after the revert delay', async () => {
    // Real timers throughout — mixing vi.useFakeTimers() with Radix's Popover (open)
    // and userEvent's own internals proved unreliable (intermittent hangs with no
    // clear single cause). A real 2.1s wait is slower but dependable; the suite-wide
    // testTimeout (vitest.config.ts) accounts for that plus this environment's
    // already-observed slow first render (~8s for openShareSheet() alone).
    const user = await openShareSheet();

    const copyButton = screen.getByRole('button', { name: 'Copy board link' });
    await user.click(copyButton);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument());
    expect(clipboardWriteText).toHaveBeenCalledWith('https://hub.example.com/w/tok');

    // The component's own revert setTimeout fires and calls setState while this raw
    // wait is in flight, outside any RTL-wrapped interaction — act() here keeps React
    // from warning about that state update happening "outside of a test".
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2100));
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Copy board link' })).toBeInTheDocument(),
    );
  });

  describe('when something fails', () => {
    const open = async () => {
      const user = userEvent.setup();
      clipboardWriteText = vi.fn().mockRejectedValue(new Error('denied'));
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: clipboardWriteText },
        configurable: true,
      });
      renderWithProviders(
        <ShareSheet
          boardName="Product planning"
          boardId="board-1"
          ownerId="user-1"
          isOwner
          isBelowTablet={false}
        />,
      );
      await user.click(screen.getByRole('button', { name: 'Share board' }));
      return user;
    };

    it('a share link that failed to load is said, with Try again, and no new link is made', async () => {
      vi.mocked(shareLinkApi.get).mockRejectedValue(
        Object.assign(new Error('500'), { status: 500, code: 'INTERNAL_SERVER_ERROR' }),
      );
      await open();
      expect(await screen.findByText('Couldn’t load the share link')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Try again' }).length).toBeGreaterThan(0);
      expect(shareLinkApi.createOrUpdate).not.toHaveBeenCalled();
    });

    it('a board without a link waits for explicit enabling', async () => {
      vi.mocked(shareLinkApi.get).mockRejectedValue(
        Object.assign(new Error('404'), { status: 404, code: 'NOT_FOUND' }),
      );
      const user = await open();
      expect(await screen.findByRole('button', { name: 'Enable link sharing' })).toBeEnabled();
      expect(shareLinkApi.createOrUpdate).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Enable link sharing' }));
      expect(await screen.findByRole('button', { name: 'Copy board link' })).toBeEnabled();
    });

    it('members that failed to load are said, with Try again', async () => {
      vi.mocked(membersApi.list).mockRejectedValue(
        Object.assign(new Error('500'), { status: 500 }),
      );
      await open();
      expect(await screen.findByText('Couldn’t load the members')).toBeInTheDocument();
    });

    it('a copy the browser refuses says how to copy by hand', async () => {
      const user = await open();
      await screen.findByDisplayValue('https://hub.example.com/w/tok');
      await user.click(screen.getByRole('button', { name: 'Copy board link' }));
      expect(
        await screen.findByText('Couldn’t copy. Select the link and copy it.'),
      ).toBeInTheDocument();
    });

    it('an invite the server refuses says why under the field', async () => {
      vi.mocked(membersApi.invite).mockRejectedValue(
        Object.assign(new Error('422'), { status: 422, code: 'INVITE_INVALID' }),
      );
      const user = await open();
      await user.type(screen.getByRole('textbox', { name: /email/i }), 'anna@example.com{Enter}');
      expect(await screen.findByText('Couldn’t send the invite')).toBeInTheDocument();
    });
  });
});

describe('board sharing scope and link lifecycle', () => {
  it('names the board and explains the invitation scope', async () => {
    await openShareSheet();
    expect(screen.getByRole('heading', { name: 'Share “Product planning”' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Invited people can access this board only. This does not add them to your organization or give access to other boards.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('People with access')).toBeInTheDocument();
  });

  it('waits for an explicit action to enable a missing link', async () => {
    vi.mocked(shareLinkApi.get).mockRejectedValue(
      Object.assign(new Error('Missing'), { status: 404 }),
    );
    const user = await openShareSheet(false);
    const enable = await screen.findByRole('button', { name: 'Enable link sharing' });
    expect(shareLinkApi.createOrUpdate).not.toHaveBeenCalled();
    await user.click(enable);
    expect(await screen.findByRole('button', { name: 'Copy board link' })).toBeEnabled();
  });

  it('shows a retry after a failed lookup without enabling access', async () => {
    vi.mocked(shareLinkApi.get).mockRejectedValue(new Error('Unavailable'));
    const user = await openShareSheet(false);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the share link');
    expect(screen.queryByRole('button', { name: 'Enable link sharing' })).not.toBeInTheDocument();
    expect(shareLinkApi.createOrUpdate).not.toHaveBeenCalled();
    vi.mocked(shareLinkApi.get).mockResolvedValue({
      token: 'tok',
      role: 'VIEW',
      url: 'https://hub.example.com/w/tok',
    });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Copy board link' })).toBeEnabled();
  });

  it('can disable a link while preserving directly invited people', async () => {
    vi.mocked(shareLinkApi.remove).mockImplementation(async () => {
      vi.mocked(shareLinkApi.get).mockRejectedValue(
        Object.assign(new Error('Missing'), { status: 404 }),
      );
    });
    const user = await openShareSheet();
    await user.click(screen.getByRole('button', { name: 'Disable link' }));
    expect(await screen.findByRole('button', { name: 'Enable link sharing' })).toBeEnabled();
    expect(screen.getByText('Mika Brandt')).toBeInTheDocument();
  });

  it('regenerates a link after explaining that the old link will stop working', async () => {
    vi.mocked(shareLinkApi.rotate).mockImplementation(async () => {
      const link = { token: 'new', role: 'VIEW' as const, url: 'https://hub.example.com/w/new' };
      vi.mocked(shareLinkApi.get).mockResolvedValue(link);
      return link;
    });
    const user = await openShareSheet();
    await user.click(screen.getByRole('button', { name: 'Regenerate link' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'The old link will stop working. People already added to this board keep their access.',
    );
    await user.click(screen.getByRole('button', { name: 'Replace link' }));
    expect(await screen.findByDisplayValue('https://hub.example.com/w/new')).toBeInTheDocument();
  });
});

it('shows a regeneration failure inside the confirmation dialog', async () => {
  vi.mocked(shareLinkApi.rotate).mockRejectedValue(new Error('Unavailable'));
  const user = await openShareSheet();
  await user.click(screen.getByRole('button', { name: 'Regenerate link' }));
  await user.click(screen.getByRole('button', { name: 'Replace link' }));
  expect(await within(screen.getByRole('alertdialog')).findByRole('alert')).toHaveTextContent(
    'Could not update link settings. Please try again.',
  );
});

it('clears an earlier disable failure when a role update succeeds', async () => {
  vi.mocked(shareLinkApi.remove).mockRejectedValue(new Error('Unavailable'));
  const user = await openShareSheet();
  await user.click(screen.getByRole('button', { name: 'Disable link' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not update link settings.');
  await user.click(screen.getByRole('combobox', { name: 'Role for the link' }));
  await user.click(await screen.findByRole('option', { name: 'Can edit' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});

it.each(['members', 'link'] as const)(
  'retains loaded sharing controls when the %s refresh fails',
  async (resource) => {
    const user = userEvent.setup();
    const view = renderWithProviders(
      <ShareSheet
        boardId="board-1"
        boardName="Product planning"
        ownerId="user-1"
        isOwner
        isBelowTablet={false}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Share board' }));
    await screen.findByDisplayValue('https://hub.example.com/w/tok');
    await screen.findByText('Mika Brandt');
    if (resource === 'members') vi.mocked(membersApi.list).mockRejectedValue(new Error('Offline'));
    else vi.mocked(shareLinkApi.get).mockRejectedValue(new Error('Offline'));
    await act(async () => {
      await view.queryClient.refetchQueries({ type: 'active' });
    });
    await screen.findByRole('alert');
    expect(screen.getByText('Mika Brandt')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://hub.example.com/w/tok')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy board link' })).toBeEnabled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      resource === 'members' ? 'Couldn’t load the members' : 'Couldn’t load the share link',
    );
  },
);
