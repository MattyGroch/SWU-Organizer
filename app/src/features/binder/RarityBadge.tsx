import type { ReactNode } from 'react';

import { rarityStyle } from './aspect';
import styles from './RarityBadge.module.css';

type Props = {
  rarity: string | undefined;
  className?: string;
  title?: string;
  children?: ReactNode;
};

/** A small tile in the rarity's colour with its letter knocked out. */
export function RarityBadge({ rarity, className, title, children }: Props) {
  const style = rarityStyle(rarity);
  if (!style) return null;
  return (
    <span
      className={[styles.rarity, className].filter(Boolean).join(' ')}
      style={{ color: `var(${style.colorVar})` }}
      data-rarity={rarity}
      title={title}
    >
      <b className={styles.letter}>{style.letter}</b>
      {children}
    </span>
  );
}
