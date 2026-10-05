import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createHealthStore } from '~/data/storageHealth';

import { StorageBanner } from './StorageBanner';

describe('StorageBanner', () => {
  it('shows nothing while storage answers and the app is open once', () => {
    const { container } = render(<StorageBanner store={createHealthStore()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('notes another open copy, and can be dismissed until one more opens', async () => {
    const store = createHealthStore();
    render(<StorageBanner store={store} />);
    act(() => store.setOthers(1));
    expect(screen.getByRole('status')).toHaveTextContent('also open in another tab or window');

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    act(() => store.setOthers(2));
    expect(screen.getByRole('status')).toHaveTextContent('also open in 2 other tabs or windows');
  });

  it('shows the notice again for a copy opened after the dismissed one closed', async () => {
    const store = createHealthStore();
    render(<StorageBanner store={store} />);
    act(() => store.setOthers(1));
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    act(() => store.setOthers(0));
    act(() => store.setOthers(1));
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('alerts when storage stops answering, naming the other copy as the likely cause', async () => {
    vi.useFakeTimers();
    const store = createHealthStore({ stallMs: 4000 });
    render(<StorageBanner store={store} />);
    act(() => store.setOthers(1));
    void store.track(new Promise(() => {}));
    await act(() => vi.advanceTimersByTimeAsync(5000));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Saving and loading are stuck');
    expect(alert).toHaveTextContent('also open in another tab or window');
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});
