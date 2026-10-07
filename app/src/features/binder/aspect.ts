/**
 * Aspect and rarity presentation.
 *
 * Pure, so the colour rules are testable and live in one place. The legacy app spread
 * these across `ASPECT_HEX`, `RARITY_STYLE`, `normalizedPrimaryAspectHexes`,
 * `aspectFillHexes`, `aspectSpecToCssBackground`, and a second inline-SVG variant for
 * table swatches — all inside App.tsx, all with hard-coded hex values.
 */

/** Vigilance / Command / Aggression / Cunning. Heroism and Villainy are affiliations. */
const PRIMARY_ASPECTS = ['Vigilance', 'Command', 'Aggression', 'Cunning'] as const;
const PRIMARY_SET = new Set<string>(PRIMARY_ASPECTS);

const ASPECT_VAR: Record<string, string> = {
  Vigilance: '--aspect-vigilance',
  Command: '--aspect-command',
  Aggression: '--aspect-aggression',
  Cunning: '--aspect-cunning',
  Heroism: '--aspect-heroism',
  Villainy: '--aspect-villainy',
};

export const NEUTRAL_VAR = '--aspect-neutral';

function cssVar(name: string): string {
  return `var(${name})`;
}

/**
 * The colours a card is filled with: its primary aspects, or its affiliation when it has
 * no primary (mono-Heroism white, mono-Villainy black). Empty for true neutrals.
 *
 * Consecutive duplicates collapse, so a double-pip card reads as one colour rather than
 * a gradient from itself to itself.
 */
export function aspectFillVars(aspects: readonly string[] | undefined): string[] {
  const primary: string[] = [];
  for (const aspect of aspects ?? []) {
    if (!PRIMARY_SET.has(aspect)) continue;
    const variable = ASPECT_VAR[aspect];
    if (!variable || primary[primary.length - 1] === variable) continue;
    primary.push(variable);
  }
  if (primary.length) return primary;

  if (aspects?.includes('Heroism')) return [ASPECT_VAR.Heroism!];
  if (aspects?.includes('Villainy')) return [ASPECT_VAR.Villainy!];
  return [];
}

/** Dual-aspect cards are mostly solid either side, blending only across a narrow band. */
const BLEND_PCT = 15;
const LEFT_STOP = (100 - BLEND_PCT) / 2;
const RIGHT_STOP = (100 + BLEND_PCT) / 2;

export function aspectBackground(aspects: readonly string[] | undefined): string {
  const vars = aspectFillVars(aspects);
  if (vars.length === 0) return cssVar(NEUTRAL_VAR);
  if (vars.length === 1) return cssVar(vars[0]!);

  const [first, second] = vars;
  return (
    `linear-gradient(to right, ${cssVar(first!)} 0%, ${cssVar(first!)} ${LEFT_STOP}%, ` +
    `${cssVar(second!)} ${RIGHT_STOP}%, ${cssVar(second!)} 100%)`
  );
}

/** Heroism's near-white fill is the only one that needs dark text on top. */
export function isLightFill(aspects: readonly string[] | undefined): boolean {
  const vars = aspectFillVars(aspects);
  return vars.length === 1 && vars[0] === ASPECT_VAR.Heroism;
}

export type RarityStyle = { letter: string; colorVar: string };

const RARITY: Record<string, RarityStyle> = {
  Common: { letter: 'C', colorVar: '--rarity-common' },
  Uncommon: { letter: 'U', colorVar: '--rarity-uncommon' },
  Rare: { letter: 'R', colorVar: '--rarity-rare' },
  Legendary: { letter: 'L', colorVar: '--rarity-legendary' },
  Special: { letter: 'S', colorVar: '--rarity-special' },
};

export function rarityStyle(rarity: string | undefined): RarityStyle | null {
  if (!rarity) return null;
  return RARITY[rarity] ?? null;
}
