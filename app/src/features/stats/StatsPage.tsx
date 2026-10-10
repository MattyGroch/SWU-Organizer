import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState, type CSSProperties } from 'react';

import { binderEntries, useHiddenSets } from '~/data/binderSettings';
import { db } from '~/data/db';
import {
  setNameWithoutKey,
  variantLabel,
  type LoadedSet,
  type SetManifestEntry,
} from '~/domain/catalog';
import { indexOwnership, type OwnedCounts } from '~/domain/ownership';
import type { SetKey } from '~/domain/types';
import { buildCardRows, EMPTY_FILTERS } from '~/features/binder/cardRows';
import { CollectionProgress } from '~/features/binder/CollectionProgress';
import { setAccent } from '~/features/binder/setAccent';
import { InventorySubnav } from '~/features/inventory/InventoryNav';
import { formatUsd } from '~/ui/format';
import { Loader } from '~/ui/Loader';
import { SetBadge } from '~/ui/SetBadge';

import {
  collectionHighlights,
  printingBreakdown,
  printingProgress,
  setCompletions,
  sumCompletions,
  type CardHighlight,
  type PrintingGroup,
} from './collectionStats';
import {
  cardRates,
  estimatePackMix,
  expectedCompletion,
  hitRates,
  mixedRates,
  packsToFinish,
} from './packMath';
import { packProfiles, type PackProfile } from './packProfiles';
import styles from './StatsPage.module.css';

type Props = {
  entries: SetManifestEntry[];
  sets: Map<SetKey, LoadedSet>;
};

const GROUP_LABEL: Record<PrintingGroup, string> = {
  hyperspace: 'Hyperspace',
  showcase: 'Showcase',
  prestige: 'Prestige',
  promo: 'Promos',
};

const whole = (n: number) => Math.round(n).toLocaleString('en-US');
const percent = (share: number) => `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
/** "1 in 12", or "1 in 1.3" when it's nearly every pack; "2 a pack" past one. */
function oneIn(perPack: number): string {
  if (perPack <= 0) return '—';
  if (perPack >= 1) return `${Number(perPack.toFixed(1))} a pack`;
  const every = 1 / perPack;
  return `1 in ${every < 10 ? Number(every.toFixed(1)) : whole(every)}`;
}

/**
 * Inventory › Stats: the whole collection at a glance — every set's playset bar, how the
 * copies split by printing — and, per booster set, what the cards say about the packs
 * behind them.
 */
export function StatsPage({ entries, sets }: Props) {
  const rows = useLiveQuery(() => db.owned.toArray(), []);
  const hidden = useHiddenSets();

  const ownership = useMemo(() => {
    const bySet = new Map<SetKey, Map<number, OwnedCounts>>();
    if (!rows) return bySet;
    const grouped = new Map<SetKey, typeof rows>();
    for (const row of rows) grouped.set(row.setKey, [...(grouped.get(row.setKey) ?? []), row]);
    for (const [setKey, setRows] of grouped) bySet.set(setKey, indexOwnership(setRows));
    return bySet;
  }, [rows]);

  // Every set counts toward the totals; the per-set bars follow the binder's shown sets.
  const allSets = useMemo(
    () => entries.flatMap((e) => (sets.has(e.key) ? [sets.get(e.key)!] : [])),
    [entries, sets],
  );
  const shownSets = useMemo(() => {
    const visible = new Set(binderEntries(entries, hidden ?? new Set<SetKey>()).map((e) => e.key));
    return allSets.filter((set) => visible.has(set.setKey));
  }, [entries, hidden, allSets]);

  const highlights = useMemo(() => collectionHighlights(allSets, ownership), [allSets, ownership]);
  const completions = useMemo(() => setCompletions(shownSets, ownership), [shownSets, ownership]);
  const allTotals = useMemo(() => sumCompletions(completions), [completions]);
  const { chase } = highlights;
  const breakdown = useMemo(() => printingBreakdown(ownership.values()), [ownership]);

  const packSets = shownSets.filter((set) => packProfiles(set.setKey));
  const [packSetKey, setPackSetKey] = useState<SetKey | undefined>();
  const packSet =
    packSets.find((set) => set.setKey === packSetKey) ??
    // Default to the set with the most cards in it: the one with packs to talk about.
    [...packSets].sort(
      (a, b) =>
        (completions.find((c) => c.setKey === b.setKey)?.copies ?? 0) -
        (completions.find((c) => c.setKey === a.setKey)?.copies ?? 0),
    )[0];

  if (!rows || !hidden) return <Loader label="Counting the collection" />;

  return (
    <div className={styles.page}>
      <InventorySubnav current="stats" />

      <section className={styles.section} aria-labelledby="stats-collection">
        <h2 id="stats-collection" className={styles.heading}>
          Collection
        </h2>
        <CollectionProgress totals={allTotals} title="All sets" />
        <div className={styles.tiles}>
          <Tile label="Copies" value={whole(highlights.copies)} />
          <Tile label="Different cards" value={whole(highlights.cards)} />
          <Tile label="Market value" value={formatUsd(highlights.value)} />
          <Tile
            label="To finish, in singles"
            value={formatUsd(allTotals.missingCost)}
            note="Missing cards at their Normal price"
          />
          <Tile
            label="Chase cards"
            value={whole(chase.showcase + chase.serialized + chase.prestigeFoil)}
            note={`${chase.showcase} Showcase\n${chase.serialized} Serialized\n${chase.prestigeFoil} Prestige Foil`}
          />
          {highlights.mostValuable && (
            <Tile
              label="Most valuable"
              value={formatUsd(highlights.mostValuable.amount)}
              card={highlights.mostValuable}
            />
          )}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="stats-sets">
        <h2 id="stats-sets" className={styles.heading}>
          Playsets by set
        </h2>
        <ul className={styles.setList}>
          {completions.map((completion) => {
            const set = sets.get(completion.setKey)!;
            const progress = printingProgress(set, ownership.get(set.setKey));
            const accent = setAccent(set.setKey);
            return (
              <li
                key={set.setKey}
                className={styles.setRow}
                style={accent ? ({ '--row-accent': accent } as CSSProperties) : undefined}
              >
                <Link
                  to="/inventory/$setKey/$view"
                  params={{ setKey: set.setKey, view: 'binder' }}
                  className={styles.setName}
                >
                  {setNameWithoutKey(set.label, set.setKey)} <SetBadge setKey={set.setKey} />
                </Link>
                <CollectionProgress totals={completion.totals} compact />
                <div className={styles.masterSet}>
                  {(Object.keys(progress) as PrintingGroup[])
                    .filter((group) => progress[group].total > 0)
                    .map((group) => (
                      <span
                        key={group}
                        title={`${progress[group].owned} of ${progress[group].total} ${GROUP_LABEL[group]} printings owned`}
                      >
                        {GROUP_LABEL[group]}{' '}
                        <strong>
                          {progress[group].owned}/{progress[group].total}
                        </strong>
                      </span>
                    ))}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="stats-printings">
        <h2 id="stats-printings" className={styles.heading}>
          Printings
        </h2>
        {breakdown.length === 0 ? (
          <p className={styles.note}>No cards yet.</p>
        ) : (
          <ul className={styles.breakdown}>
            {breakdown.map((item) => (
              <li key={item.variant} className={styles.breakdownRow}>
                <span className={styles.breakdownLabel}>{variantLabel(item.variant)}</span>
                <span className={styles.breakdownTrack} aria-hidden="true">
                  <span
                    className={styles.breakdownFill}
                    data-variant={item.variant}
                    style={{ width: `${Math.max(item.share * 100, 0.5)}%` }}
                  />
                </span>
                <span className={styles.breakdownValue}>
                  {percent(item.share)} <span className={styles.muted}>· {whole(item.copies)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {packSet && (
        <section className={styles.section} aria-labelledby="stats-packs">
          <div className={styles.packHead}>
            <h2 id="stats-packs" className={styles.heading}>
              Packs
            </h2>
            <label>
              <span className="visually-hidden">Set</span>
              <select
                className={styles.select}
                value={packSet.setKey}
                onChange={(event) => setPackSetKey(event.target.value)}
              >
                {packSets.map((set) => (
                  <option key={set.setKey} value={set.setKey}>
                    {set.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <PackStats set={packSet} owned={ownership.get(packSet.setKey) ?? new Map()} />
        </section>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  card,
  note,
}: {
  label: string;
  value: string;
  card?: CardHighlight;
  /** A small line under the value. */
  note?: string;
}) {
  return (
    <div className={styles.tile}>
      <span className={styles.tileLabel}>{label}</span>
      <span className={styles.tileValue}>{value}</span>
      {note && <span className={styles.tileNote}>{note}</span>}
      {card && (
        <Link
          to="/inventory/$setKey/$view"
          params={{ setKey: card.setKey, view: 'binder' }}
          search={{ card: card.base }}
          className={styles.tileCard}
        >
          {card.name}
          {card.subtitle && <span className={styles.muted}> · {card.subtitle}</span>}
        </Link>
      )}
    </div>
  );
}

function PackStats({ set, owned }: { set: LoadedSet; owned: ReadonlyMap<number, OwnedCounts> }) {
  const profiles = packProfiles(set.setKey)!;
  const { booster, carbonite } = profiles;
  const mix = useMemo(() => estimatePackMix(set, profiles, owned), [set, profiles, owned]);
  const rates = useMemo(
    () => mixedRates(set, profiles, owned, { boosters: 1, carbonite: 0 }),
    [set, profiles, owned],
  );
  const hits = hitRates(set, profiles, owned, mix);

  const actual =
    rates.length > 0 ? rates.filter((r) => r.owned >= r.quota).length / rates.length : 0;
  const expected = mix ? expectedCompletion(mixedRates(set, profiles, owned, mix), 1) : 0;

  const singles = useMemo(
    () =>
      buildCardRows(set, owned, EMPTY_FILTERS)
        .filter((row) => rates.some((r) => r.card.base === row.base))
        .reduce((sum, row) => sum + row.missingCost, 0),
    [set, owned, rates],
  );
  const finishes = useMemo(
    () =>
      [booster, carbonite]
        .filter((p): p is PackProfile => !!p)
        .map((profile) => ({
          profile,
          finish: packsToFinish(cardRates(set, profile, owned)),
        })),
    [set, owned, booster, carbonite],
  );

  return (
    <div className={styles.packs}>
      <p className={styles.note}>
        <strong>Booster:</strong> {booster.summary}
        {carbonite && (
          <>
            {' '}
            <strong>Carbonite:</strong> {carbonite.summary}
          </>
        )}
      </p>

      <div className={styles.tiles}>
        <Tile label="Boosters, about" value={mix ? whole(mix.boosters) : '—'} />
        {carbonite && <Tile label="Carbonite, about" value={mix ? whole(mix.carbonite) : '—'} />}
        <Tile label="Playsets complete" value={percent(actual)} />
        <Tile label="The odds say" value={mix ? percent(expected) : '—'} />
      </div>
      {mix && (
        <p className={styles.note}>
          {luckLine(actual, expected)} The pack counts are read from your Commons and Uncommons —{' '}
          {carbonite
            ? 'plain ones come from boosters, foil and Hyperspace ones mostly from Carbonite — and your Prestige cards.'
            : 'about 12 a pack.'}{' '}
          Promos and Special cards aren't counted.
        </p>
      )}

      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <caption className={styles.caption}>Hit rate · odds per pack</caption>
          <thead>
            <tr>
              <th scope="col">Pull</th>
              <th scope="col">Own</th>
              <th scope="col" title="What the packs above should have given">
                Expected
              </th>
              <th scope="col" className={styles.oddsCol}>
                Booster
              </th>
              {carbonite && (
                <th scope="col" className={styles.oddsCol}>
                  Carbonite
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {hits.map((hit) => (
              <tr key={hit.label}>
                <th scope="row">
                  {hit.label}
                  {/* Phones: the odds columns fold into a line under the name. */}
                  <span className={styles.oddsInline}>
                    {carbonite
                      ? `Booster ${oneIn(hit.booster)} · Carbonite ${oneIn(hit.carbonite)}`
                      : oneIn(hit.booster)}
                  </span>
                </th>
                <td>
                  {whole(hit.owned)}
                  {hit.expected !== undefined && <Luck owned={hit.owned} expected={hit.expected} />}
                </td>
                <td>{hit.expected === undefined ? '—' : about(hit.expected)}</td>
                <td className={styles.oddsCol}>{oneIn(hit.booster)}</td>
                {carbonite && <td className={styles.oddsCol}>{oneIn(hit.carbonite)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <table className={styles.table}>
        <caption className={styles.caption}>Finishing the playsets</caption>
        <thead>
          <tr>
            <th scope="col">Route</th>
            <th scope="col">Packs, about</th>
            <th scope="col">Cost</th>
          </tr>
        </thead>
        <tbody>
          {finishes.map(({ profile, finish }) => (
            <tr key={profile.name}>
              <th scope="row">
                {profile.name} <span className={styles.muted}>@ {formatUsd(profile.price)}</span>
              </th>
              <td>
                {finish.needed === 0 ? (
                  'Done'
                ) : (
                  <>
                    {whole(finish.expected)}{' '}
                    <span className={styles.range}>
                      half the time {whole(finish.median)}, 9 in 10 {whole(finish.likely)}
                    </span>
                  </>
                )}
              </td>
              <td>{formatUsd(finish.expected * profile.price)}</td>
            </tr>
          ))}
          <tr>
            <th scope="row">Singles</th>
            <td className={styles.muted}>{finishes[0]?.finish.needed ?? 0} cards</td>
            <td>{formatUsd(singles)}</td>
          </tr>
        </tbody>
      </table>
      <p className={styles.note}>
        Any printing fills a playset, so foils and Hyperspace count. Singles are priced at each
        card's Normal printing. Packs are a rough model: every card of a rarity is assumed equally
        likely, and FFG doesn't publish the Rare leader rate or a Carbonite pack's rarity mix, so
        those are estimates.
      </p>
    </div>
  );
}

/** A count to the nearest whole, or tenth when it's small. */
function about(n: number): string {
  return n < 10 ? String(Number(n.toFixed(1))) : whole(n);
}

/**
 * ▲ or ▼ beside a count well off what the packs should give: more than a couple of
 * standard deviations (counts vary by about their square root).
 */
function Luck({ owned, expected }: { owned: number; expected: number }) {
  const spread = 2 * Math.sqrt(Math.max(expected, 1));
  if (Math.abs(owned - expected) <= spread) return null;
  const up = owned > expected;
  return (
    <span
      className={styles.luck}
      data-up={up}
      title={up ? 'Well above the odds' : 'Well below the odds'}
    >
      {up ? ' ▲' : ' ▼'}
    </span>
  );
}

function luckLine(actual: number, expected: number): string {
  const diff = actual - expected;
  if (Math.abs(diff) < 0.03) return 'Right about where the odds put you.';
  return diff > 0
    ? `${percent(diff)} ahead of the odds — singles, trades or good luck.`
    : `${percent(-diff)} behind the odds.`;
}
