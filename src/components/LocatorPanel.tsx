import type { ActiveSelection } from '../core/types';

type LocatorPanelProps = {
  selection: ActiveSelection;
  quantity: number;
  maximum: number;
  aspectBackground?: string;
  onDecrease: () => void;
  onIncrease: () => void;
};

export function LocatorPanel({
  selection,
  quantity,
  maximum,
  aspectBackground,
  onDecrease,
  onIncrease,
}: LocatorPanelProps) {
  const { card } = selection;

  return (
    <section className="locator-panel" aria-live="polite">
      <div
        className="locator-aspect"
        style={aspectBackground ? { background: aspectBackground } : undefined}
        aria-hidden="true"
      />
      <h2 className="locator-name">{card.Name}</h2>
      {card.Subtitle && <p className="locator-subtitle">{card.Subtitle}</p>}
      <p className="locator-number">Card #{card.Number}</p>

      <dl className="locator-location">
        <div>
          <dt>Page</dt>
          <dd className="locator-value">{selection.page}</dd>
        </div>
        <div>
          <dt>Row</dt>
          <dd className="locator-value">{selection.row}</dd>
        </div>
        <div>
          <dt>Column</dt>
          <dd className="locator-value">{selection.column}</dd>
        </div>
      </dl>

      <div className="locator-qty" aria-label={`${card.Name} quantity`}>
        <button
          type="button"
          aria-label={`Decrease ${card.Name} quantity`}
          onClick={onDecrease}
          disabled={quantity <= 0}
        >
          &minus;
        </button>
        <output aria-label="Quantity">
          {quantity}/{maximum}
        </output>
        <button
          type="button"
          aria-label={`Increase ${card.Name} quantity`}
          onClick={onIncrease}
          disabled={quantity >= maximum}
        >
          +
        </button>
      </div>
    </section>
  );
}
