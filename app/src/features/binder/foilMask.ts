/**
 * Where a foil's shine stops.
 *
 * On a real SWU foil the art and frame are foil, but the printed game information is matte:
 * cost, aspect icons, type bar, title, subtitle, traits, power, HP and the rules text. The
 * binder's holo overlay is masked off exactly those, as measured on the card scans (SOR and
 * HMW, the oldest and newest frames).
 */

/** A box as a percentage of the printed card: left, top, right, bottom. */
export type Box = readonly [x1: number, y1: number, x2: number, y2: number];

/* Portrait cards: units, upgrades and events share their top-left corner. */
const COST: Box = [4, 2.5, 16.5, 11.5];
const TYPE_BAR: Box = [10.5, 2.5, 95, 5.5];
const TITLE: Box = [16, 5.5, 95.5, 11.5];
/** Only on cards with a subtitle (unique characters); hangs under the title. */
const SUBTITLE: Box = [20, 11, 89, 14];

/** The aspect icons stack down the left edge under the cost, one per aspect. */
function aspectColumn(count: number): Box[] {
  return count > 0 ? [[4.5, 11.5, 16, 11.5 + 7.5 * count]] : [];
}

const UNIT: readonly Box[] = [
  COST,
  TYPE_BAR,
  TITLE,
  [4, 58, 17, 69.5], // power
  [82, 58, 95.5, 69.5], // HP
  [16, 63, 84, 68.5], // traits, between them
  [5, 68.5, 95.5, 94], // rules text
];

const UPGRADE: readonly Box[] = [
  COST,
  TYPE_BAR,
  TITLE,
  [4, 55.5, 96, 82.5], // rules text
  [4, 83, 17, 94.5], // power modifier
  [82, 83, 95.5, 94.5], // HP modifier
  [14, 83, 86, 94.5], // the upgrade bar: name again and traits, between the modifiers
];

const EVENT: readonly Box[] = [
  COST,
  TYPE_BAR,
  TITLE,
  [11, 18, 88.5, 50.5], // rules text; the art is below
];

/* Leaders and bases are measured on the card as printed, landscape. */

/** Their aspect icons stack down the right edge, from the top. */
function landscapeAspects(count: number): Box[] {
  return count > 0 ? [[88, 4, 97, 4 + 14.5 * count]] : [];
}

const LEADER: readonly Box[] = [
  [3, 4, 88, 8], // type bar
  [42, 7, 88.5, 15.5], // title
  [46, 15, 86, 20.5], // subtitle
  [45.5, 20.5, 91.5, 88.5], // rules text, and the deploy box with power and HP
  [3.5, 80.5, 45.5, 88.5], // traits, under the art
];

const BASE: readonly Box[] = [
  [3, 3, 12.5, 14], // HP
  [11, 4, 88, 8], // type bar
  [15.5, 7.5, 85, 16.5], // title
  [3, 62.5, 97, 92], // rules text and location
];

/**
 * A landscape box as it lands in the pocket. Leaders and bases go in turned 90°
 * anticlockwise, so the printed top edge becomes the pocket's left and the printed right
 * edge its top.
 */
export function turnAnticlockwise([x1, y1, x2, y2]: Box): Box {
  return [y1, 100 - x2, y2, 100 - x1];
}

export type MaskedCard = {
  type: string | undefined;
  hasSubtitle: boolean;
  /** How many aspect icons the card prints. */
  aspects: number;
};

/** The matte parts of a card, in the pocket's own frame. */
export function matteBoxes({ type, hasSubtitle, aspects }: MaskedCard): readonly Box[] {
  switch ((type ?? '').trim().toLowerCase()) {
    case 'leader':
      return [...LEADER, ...landscapeAspects(aspects)].map(turnAnticlockwise);
    case 'base':
      return [...BASE, ...landscapeAspects(aspects)].map(turnAnticlockwise);
    case 'event':
      return [...EVENT, ...aspectColumn(aspects)];
    case 'upgrade':
      return [...UPGRADE, ...aspectColumn(aspects)];
    default:
      return [...UNIT, ...(hasSubtitle ? [SUBTITLE] : []), ...aspectColumn(aspects)];
  }
}

const cache = new Map<string, string>();

/**
 * A CSS `mask-image`: opaque everywhere but the matte parts. An SVG stretched over the
 * pocket, so the boxes are plain percentages.
 */
export function foilMask(card: MaskedCard): string {
  const key = `${card.type}:${card.hasSubtitle}:${card.aspects}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const holes = matteBoxes(card)
    .map(
      ([x1, y1, x2, y2]) =>
        `<rect x='${x1}' y='${y1}' width='${x2 - x1}' height='${y2 - y1}' rx='1'/>`,
    )
    .join('');
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'>` +
    `<mask id='m'><rect width='100' height='100' fill='white'/><g fill='black'>${holes}</g></mask>` +
    `<rect width='100' height='100' mask='url(#m)'/></svg>`;
  const mask = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  cache.set(key, mask);
  return mask;
}
