import { expect, it, vi } from 'vitest';
import { screen, within, fireEvent, act } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
const auth = vi.hoisted(() => ({ status: 'unauthenticated' }));
vi.mock('@/features/auth/AuthProvider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/auth/AuthProvider')>()),
  useAuth: () => auth,
}));
vi.mock('@/i18n/LanguageProvider', () => ({
  useLanguage: () => ({ language: 'en', setLanguage: vi.fn() }),
}));
vi.mock('@/lib/resources', () => ({ boardsApi: { list: vi.fn().mockResolvedValue([]) } }));
import { i18n } from '@/i18n';
import { HomePage } from './HomePage';

it('keeps the landing and signup entry points available to visitors', () => {
  auth.status = 'unauthenticated';
  renderWithProviders(<HomePage />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'Drop it on the wall. Wally does the rest.',
  );
  expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
  expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/signup');
  for (const link of screen.getAllByRole('link', { name: 'Start your wall' })) {
    expect(link).toHaveAttribute('href', '/signup');
  }
});

it('offers the boards from every landing CTA when already signed in', () => {
  auth.status = 'authenticated';
  renderWithProviders(<HomePage />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'Drop it on the wall. Wally does the rest.',
  );
  expect(screen.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Sign up' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Start your wall' })).not.toBeInTheDocument();
  const links = screen.getAllByRole('link', { name: 'Open Wally' });
  expect(links).toHaveLength(2);
  for (const link of links) expect(link).toHaveAttribute('href', '/boards');
});

it('waits for auth resolution before offering login or signup, then updates in place', () => {
  auth.status = 'loading';
  const { rerender } = renderWithProviders(<HomePage />);
  expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Sign up' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Start your wall' })).not.toBeInTheDocument();
  auth.status = 'authenticated';
  rerender(<HomePage />);
  expect(screen.getAllByRole('link', { name: 'Open Wally' })).toHaveLength(2);
});

it('switches the example views without navigating away from the landing page', () => {
  auth.status = 'unauthenticated';
  renderWithProviders(<HomePage />);
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Priority' }), { button: 0, ctrlKey: false });
  expect(screen.getByRole('tab', { name: 'Priority' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tabpanel')).toHaveTextContent('High, medium and low.');
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Focus' }), { button: 0, ctrlKey: false });
  expect(
    within(screen.getByRole('tabpanel')).getByText('Step 1 of 3 · Do a final read'),
  ).toBeVisible();
});

it('opens and closes the reference FAQ answers accessibly', () => {
  renderWithProviders(<HomePage />);
  const question = screen.getByRole('button', {
    name: 'Does the AI change my notes without asking?',
  });
  expect(question).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(question);
  expect(question).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText(/Changes appear as a suggestion on the card/)).toBeVisible();
  fireEvent.click(question);
  expect(question).toHaveAttribute('aria-expanded', 'false');
});

it('runs the local card demo and can keep or undo an example', () => {
  vi.useFakeTimers();
  try {
    renderWithProviders(<HomePage />);
    const demo = within(screen.getByRole('region', { name: 'Interactive demo' }));
    const input = demo.getByRole('textbox', { name: 'Try a note' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'send proposal to maya fri urgent' } });
    fireEvent.click(demo.getByRole('button', { name: 'Add' }));
    act(() => vi.advanceTimersByTime(3200));
    expect(demo.getByText('Send proposal to Maya')).toBeVisible();
    fireEvent.click(demo.getByRole('button', { name: 'Keep' }));
    act(() => vi.advanceTimersByTime(1500));
    expect(demo.getByLabelText('This week sample notes')).toHaveTextContent('4');
    fireEvent.change(input, { target: { value: 'idea: simplify onboarding' } });
    fireEvent.click(demo.getByRole('button', { name: 'Add' }));
    act(() => vi.advanceTimersByTime(3200));
    fireEvent.click(demo.getByRole('button', { name: 'Undo' }));
    expect(input).toHaveValue('idea: simplify onboarding');
    expect(demo.getByLabelText('Ideas sample notes')).toHaveTextContent('1');
  } finally {
    vi.useRealTimers();
  }
});

it('lets visitors pause the animated examples', () => {
  vi.useFakeTimers();
  try {
    renderWithProviders(<HomePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause animations' }));
    const input = screen.getByRole('textbox', { name: 'Try a note' });
    const value = (input as HTMLInputElement).value;
    act(() => vi.advanceTimersByTime(2000));
    expect(input).toHaveValue(value);
    fireEvent.click(screen.getByRole('button', { name: 'Play animations' }));
    act(() => vi.advanceTimersByTime(1000));
    expect((input as HTMLInputElement).value.length).toBeGreaterThan(value.length);
  } finally {
    vi.useRealTimers();
  }
});

it('keeps user-entered demo text while translating its controls and suggestions', async () => {
  renderWithProviders(<HomePage />);
  const input = screen.getByRole('textbox', { name: 'Try a note' });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: 'My original note' } });
  await act(() => i18n.changeLanguage('de'));
  expect(screen.getByRole('textbox', { name: 'Probiere eine Notiz' })).toHaveValue(
    'My original note',
  );
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'Ab an die Wand. Wally macht den Rest.',
  );
});

it('shows the demo immediately without autoplay when reduced motion is requested', () => {
  const original = window.matchMedia;
  const media = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...original(query),
    matches: query === '(prefers-reduced-motion: reduce)',
  }));
  try {
    renderWithProviders(<HomePage />);
    expect(screen.queryByRole('button', { name: 'Pause animations' })).not.toBeInTheDocument();
    const demo = within(screen.getByRole('region', { name: 'Interactive demo' }));
    fireEvent.click(demo.getByRole('button', { name: 'Play voice demo' }));
    expect(demo.getByRole('button', { name: 'Keep' })).toBeVisible();
    fireEvent.click(demo.getByRole('button', { name: 'Keep' }));
    expect(demo.getByLabelText('Meetings sample notes')).toHaveTextContent('2');
  } finally {
    media.mockRestore();
  }
});
