import aggression from '~/assets/aspects/aggression.webp';
import command from '~/assets/aspects/command.webp';
import cunning from '~/assets/aspects/cunning.webp';
import heroism from '~/assets/aspects/heroism.webp';
import vigilance from '~/assets/aspects/vigilance.webp';
import villainy from '~/assets/aspects/villainy.webp';

/* Fan recreations of the game's aspect symbols: see src/assets/aspects/CREDITS.md. */
const ICON: Record<string, string> = {
  Vigilance: vigilance,
  Command: command,
  Aggression: aggression,
  Cunning: cunning,
  Heroism: heroism,
  Villainy: villainy,
};

/** The icon for an aspect, or undefined for Neutral (which has none). */
export function aspectIcon(aspect: string): string | undefined {
  return ICON[aspect];
}
