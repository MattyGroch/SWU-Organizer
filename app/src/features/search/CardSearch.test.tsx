import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { parseSetCatalog, toLoadedSet, toSearchCatalog } from '~/domain/catalog';

import { CardSearch } from './CardSearch';

const sor = toSearchCatalog(
  toLoadedSet(
    parseSetCatalog({
      setKey: 'SOR',
      label: 'SOR',
      cards: [
        {
          base: 10,
          name: 'Darth Vader',
          subtitle: 'Dark Lord of the Sith',
          type: 'Leader',
          aspects: [],
          printings: [
            { num: '010', variant: 'normal' },
            { num: '278', variant: 'hyperspace' },
          ],
        },
        {
          base: 59,
          name: '2-1B Surgical Droid',
          type: 'Unit',
          aspects: [],
          printings: [{ num: '059', variant: 'normal' }],
        },
      ],
    }),
    new Map(),
  ),
);

const lof = toSearchCatalog(
  toLoadedSet(
    parseSetCatalog({
      setKey: 'LOF',
      label: 'LOF',
      cards: [
        {
          base: 142,
          name: 'Adi Gallia',
          subtitle: 'Stern and Focused',
          type: 'Unit',
          aspects: [],
          printings: [{ num: '142', variant: 'normal' }],
        },
      ],
    }),
    new Map(),
  ),
);

function renderSearch() {
  const onChoose = vi.fn();
  const inputRef = createRef<HTMLInputElement>();
  render(
    <CardSearch
      catalogs={[sor, lof]}
      currentSetKey="SOR"
      inputRef={inputRef}
      onChoose={onChoose}
    />,
  );
  return { onChoose, input: screen.getByRole('combobox') };
}

describe('CardSearch', () => {
  it('exposes the ARIA combobox contract', () => {
    const { input } = renderSearch();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveAttribute('aria-autocomplete', 'list');
    expect(input).toHaveAccessibleName('Search cards by name or number');
  });

  it('suggests cards by name and marks the list expanded', async () => {
    const user = userEvent.setup();
    const { input } = renderSearch();

    await user.type(input, 'vader');

    expect(input).toHaveAttribute('aria-expanded', 'true');
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Darth Vader');
  });

  it('searches across every loaded set, not just the current one', async () => {
    const user = userEvent.setup();
    const { input } = renderSearch();

    await user.type(input, 'adi');

    expect(screen.getByRole('option')).toHaveTextContent('Adi Gallia');
    expect(screen.getByRole('option')).toHaveTextContent('LOF');
  });

  it('finds cards by printing number, including alternate printings', async () => {
    const user = userEvent.setup();
    const { input } = renderSearch();

    await user.type(input, '278');

    expect(screen.getByRole('option')).toHaveTextContent('Darth Vader');
  });

  it('announces the result count to screen readers', async () => {
    const user = userEvent.setup();
    const { input } = renderSearch();

    await user.type(input, 'vader');

    expect(screen.getByRole('status')).toHaveTextContent('1 result');
  });

  it('moves the active option with arrow keys via aria-activedescendant', async () => {
    const user = userEvent.setup();
    const { input } = renderSearch();

    await user.type(input, 'a');
    const first = input.getAttribute('aria-activedescendant');
    expect(first).toBeTruthy();

    await user.keyboard('{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).not.toBe(first);
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('chooses the highlighted suggestion on Enter and clears the query', async () => {
    const user = userEvent.setup();
    const { input, onChoose } = renderSearch();

    await user.type(input, 'vader');
    await user.keyboard('{Enter}');

    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose.mock.calls[0]![0]).toMatchObject({ setKey: 'SOR', baseNumber: 10 });
    expect(input).toHaveValue('');
  });

  it('chooses a suggestion on click', async () => {
    const user = userEvent.setup();
    const { input, onChoose } = renderSearch();

    await user.type(input, 'adi');
    await user.click(screen.getByRole('option'));

    expect(onChoose.mock.calls[0]![0]).toMatchObject({ setKey: 'LOF', baseNumber: 142 });
  });

  it('keeps the keyboard-highlighted option scrolled into view', async () => {
    const user = userEvent.setup();
    const { input } = renderSearch();

    // jsdom has no layout, so scrollIntoView is observed rather than measured.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    await user.type(input, 'a');
    scrollIntoView.mockClear();
    await user.keyboard('{ArrowDown}');

    // 'nearest' scrolls only as far as needed instead of recentring the list.
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('shows many matches rather than a handful, since search spans every set', async () => {
    const user = userEvent.setup();
    const { input } = renderSearch();

    // The old limit of 10 silently hid matches: "Vader" alone is 13 cards across 8 sets.
    await user.type(input, 'a');
    expect(screen.getAllByRole('option').length).toBeGreaterThan(1);
    expect(screen.queryByText(/keep typing to narrow it down/)).toBeNull();
  });

  it('closes the list on Escape without choosing anything', async () => {
    const user = userEvent.setup();
    const { input, onChoose } = renderSearch();

    await user.type(input, 'vader');
    await user.keyboard('{Escape}');

    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(onChoose).not.toHaveBeenCalled();
  });
});
