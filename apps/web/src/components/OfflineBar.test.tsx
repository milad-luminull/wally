import { afterEach, describe, expect, it } from 'vitest';
import { act, screen } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { renderWithProviders } from '@/test/renderWithProviders';
import { OfflineBar } from './OfflineBar';

afterEach(() => act(() => onlineManager.setOnline(true)));

describe('OfflineBar', () => {
  it('says the person is offline and that changes wait, and goes once they are back', () => {
    renderWithProviders(<OfflineBar />);
    expect(screen.queryByRole('status')).toBeNull();
    act(() => onlineManager.setOnline(false));
    expect(screen.getByRole('status')).toHaveTextContent(
      'You’re offline. Changes are saved when you’re back.',
    );
    act(() => onlineManager.setOnline(true));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
