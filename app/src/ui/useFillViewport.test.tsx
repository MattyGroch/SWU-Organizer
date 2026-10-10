import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useFillViewport } from './useFillViewport';

function Box({ mounted = true }: { mounted?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFillViewport(ref, mounted);
  return mounted ? <div ref={ref} data-testid="box" /> : null;
}

function placeAt(top: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    top,
  } as DOMRect);
}

describe('useFillViewport', () => {
  afterEach(() => vi.restoreAllMocks());

  it('publishes the height from the element down to the bottom of the window', () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(2000);
    placeAt(300);
    const { getByTestId } = render(<Box />);
    expect(getByTestId('box').style.getPropertyValue('--fill-height')).toBe('1684px');
  });

  it('measures again when the window resizes', () => {
    const height = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1000);
    placeAt(200);
    const { getByTestId } = render(<Box />);
    height.mockReturnValue(1400);
    act(() => window.dispatchEvent(new Event('resize')));
    expect(getByTestId('box').style.getPropertyValue('--fill-height')).toBe('1184px');
  });

  it('measures an element that mounts later', () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(1000);
    placeAt(100);
    const { rerender, getByTestId } = render(<Box mounted={false} />);
    rerender(<Box mounted />);
    expect(getByTestId('box').style.getPropertyValue('--fill-height')).toBe('884px');
  });
});
