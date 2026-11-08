import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigationType,
  type InitialEntry,
} from 'react-router';
import { useSettingsNavigation } from './useSettingsNavigation';

function Controls() {
  const nav = useSettingsNavigation();
  const location = useLocation();
  return (
    <>
      <p>at {location.pathname}</p>
      <button onClick={nav.goBack}>back</button>
      <button onClick={() => nav.openSection('language')}>language</button>
      <button onClick={nav.backToList}>list</button>
    </>
  );
}

function Probe() {
  const location = useLocation();
  const type = useNavigationType();
  return (
    <>
      <p>landed {location.pathname + location.search + location.hash}</p>
      <p>by {type}</p>
    </>
  );
}

function renderAt(entry: InitialEntry, before: InitialEntry[] = []) {
  render(
    <MemoryRouter initialEntries={[...before, entry]} initialIndex={before.length}>
      <Routes>
        <Route path="/settings" element={<Controls />} />
        <Route path="/settings/:section" element={<Controls />} />
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>,
  );
}

it('goes back to the page Settings was opened from', async () => {
  renderAt({ pathname: '/settings/appearance', state: { from: '/boards/b1?x=1' } }, [
    '/boards/b1?x=1',
  ]);
  await userEvent.click(screen.getByRole('button', { name: 'back' }));
  expect(screen.getByText('landed /boards/b1?x=1')).toBeInTheDocument();
});

it('goes to the board home when it does not know where you came from', async () => {
  renderAt('/settings/appearance');
  await userEvent.click(screen.getByRole('button', { name: 'back' }));
  expect(screen.getByText('landed /boards')).toBeInTheDocument();
});

it('keeps the origin when switching sections', async () => {
  renderAt({ pathname: '/settings/appearance', state: { from: '/boards/b1' } }, ['/boards/b1']);
  await userEvent.click(screen.getByRole('button', { name: 'language' }));
  expect(screen.getByText('at /settings/language')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'back' }));
  expect(screen.getByText('landed /boards/b1')).toBeInTheDocument();
});

it('returns to the list, keeping the origin, when a section was opened directly', async () => {
  renderAt({ pathname: '/settings/account', state: { from: '/boards/b1' } }, ['/boards/b1']);
  await userEvent.click(screen.getByRole('button', { name: 'list' }));
  expect(screen.getByText('at /settings')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'back' }));
  expect(screen.getByText('landed /boards/b1')).toBeInTheDocument();
});

it('pops back to the page it came from, so browser Back afterwards does not reopen Settings', async () => {
  renderAt({ pathname: '/settings/appearance', state: { from: '/boards/b1' } }, ['/boards/b1']);
  await userEvent.click(screen.getByRole('button', { name: 'back' }));
  expect(screen.getByText('landed /boards/b1')).toBeInTheDocument();
  expect(screen.getByText('by POP')).toBeInTheDocument();
});
