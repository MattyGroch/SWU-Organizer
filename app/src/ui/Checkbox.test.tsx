import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { Checkbox } from './Checkbox';

function Labelled({ disabled }: { disabled?: boolean }) {
  const [on, setOn] = useState(false);
  return (
    <label>
      <Checkbox checked={on} disabled={disabled} onChange={(e) => setOn(e.target.checked)} />
      <span>Include sideboard</span>
    </label>
  );
}

describe('Checkbox', () => {
  it('is a real checkbox named by its label, toggled by a click or the space bar', async () => {
    const user = userEvent.setup();
    render(<Labelled />);
    const box = screen.getByRole('checkbox', { name: 'Include sideboard' });
    expect(box).not.toBeChecked();

    await user.click(screen.getByText('Include sideboard'));
    expect(box).toBeChecked();

    await user.keyboard(' ');
    expect(box).toHaveFocus();
    expect(box).not.toBeChecked();
  });

  it('shows the dash as a mixed state', () => {
    render(<Checkbox checked={false} indeterminate aria-label="Select all" onChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'Select all' })).toHaveProperty(
      'indeterminate',
      true,
    );
  });

  it('ignores clicks when disabled', async () => {
    const user = userEvent.setup();
    render(<Labelled disabled />);
    await user.click(screen.getByText('Include sideboard'));
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });
});
