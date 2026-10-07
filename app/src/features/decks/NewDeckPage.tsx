import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import type { LoadedSet } from '~/domain/catalog';
import { buildCardPool, FORMAT_RULES, PLAY_FORMATS, type PlayFormat } from '~/domain/deckLegality';
import { newDeck, type SavedDeck } from '~/domain/decks';
import { normalize } from '~/domain/search';
import type { SetKey } from '~/domain/types';
import { Loader } from '~/ui/Loader';
import { useToast } from '~/ui/toastContext';

import { AspectIcons } from '../binder/AspectIcons';
import { CardSearch } from './CardSearch';
import { DeckEditor } from './DeckEditorPage';
import type { SearchHit } from './deckSearch';
import styles from './NewDeckPage.module.css';
import { useDeckCollection, type OwnershipBySet } from './useDeckCollection';
import { useDeckLibrary } from './useDeckLibrary';

type Props = {
  sets: Map<SetKey, LoadedSet>;
  binderOwnership: OwnershipBySet;
};

type Step = 'format' | 'leader' | 'leader2' | 'base';

const FORMAT_BLURB: Record<PlayFormat, string> = {
  premier: 'One leader, 50+ cards, up to 3 of each. Sets from Jump to Lightspeed on.',
  eternal: 'One leader, 50+ cards, up to 3 of each. Every set.',
  twinSuns: 'Two different leaders, 80+ cards, 1 of each. Every set.',
};

const hitRef = (hit: SearchHit) => ({ setKey: hit.setKey, baseNumber: hit.card.Number, count: 1 });
const title = (hit: SearchHit) => normalize(`${hit.card.Name}|${hit.card.Subtitle ?? ''}`);

/**
 * Starts a deck from nothing: format, then leader (two for Twin Suns), then base, then the
 * editor to add cards. Nothing is saved until the editor's Save.
 */
export function NewDeckPage({ sets, binderOwnership }: Props) {
  const { library, loading } = useDeckLibrary();
  const { owned } = useDeckCollection(sets, binderOwnership, library);
  const navigate = useNavigate();
  const showToast = useToast();

  const [step, setStep] = useState<Step>('format');
  const [format, setFormat] = useState<PlayFormat>('premier');
  const [leaders, setLeaders] = useState<SearchHit[]>([]);
  const [deck, setDeck] = useState<SavedDeck | null>(null);
  // Owned / All cards carries from step to step; each step's search text starts empty.
  const [ownedOnly, setOwnedOnly] = useState(true);

  const setList = useMemo(() => [...sets.values()], [sets]);
  const pool = useMemo(() => buildCardPool(setList), [setList]);

  if (loading) return <Loader label="Loading decks" />;

  if (deck) {
    return (
      <DeckEditor
        sets={sets}
        binderOwnership={binderOwnership}
        library={library}
        deck={deck}
        isNew
      />
    );
  }

  const twinSuns = format === 'twinSuns';

  function chooseFormat(next: PlayFormat) {
    setFormat(next);
    setLeaders([]);
    setStep('leader');
  }

  function chooseLeader(hit: SearchHit) {
    if (step === 'leader2') {
      if (title(hit) === title(leaders[0]!)) {
        showToast({ tone: 'warning', message: 'Twin Suns needs two different leaders.' });
        return;
      }
      setLeaders([leaders[0]!, hit]);
      setStep('base');
      return;
    }
    setLeaders([hit]);
    setStep(twinSuns ? 'leader2' : 'base');
  }

  function chooseBase(hit: SearchHit) {
    const [first, second] = leaders;
    if (!first) return;
    setDeck(
      newDeck({
        name: leaders.map((l) => l.card.Name).join(' & '),
        format,
        leader: hitRef(first),
        secondLeader: second && hitRef(second),
        base: hitRef(hit),
      }),
    );
  }

  function back() {
    if (step === 'base') {
      setLeaders(twinSuns ? leaders.slice(0, 1) : []);
      setStep(twinSuns ? 'leader2' : 'leader');
    } else if (step === 'leader2') {
      setLeaders([]);
      setStep('leader');
    } else setStep('format');
  }

  const steps: Step[] = twinSuns
    ? ['format', 'leader', 'leader2', 'base']
    : ['format', 'leader', 'base'];
  const STEP_LABEL: Record<Step, string> = {
    format: 'Format',
    leader: twinSuns ? 'Leader 1' : 'Leader',
    leader2: 'Leader 2',
    base: 'Base',
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button
          type="button"
          className={styles.back}
          onClick={() => void navigate({ to: '/decks' })}
        >
          ← Decks
        </button>
        <h1 className={styles.title}>New deck</h1>
      </header>

      <ol className={styles.steps} aria-label="Steps">
        {steps.map((s, i) => (
          <li key={s} aria-current={s === step ? 'step' : undefined}>
            {i + 1}. {STEP_LABEL[s]}
          </li>
        ))}
        <li>{steps.length + 1}. Cards</li>
      </ol>

      {step !== 'format' && (
        <p className={styles.picked}>
          <span className={styles.pill}>{FORMAT_RULES[format].label}</span>
          {leaders.map((l) => (
            <span key={`${l.setKey}:${l.card.Number}`} className={styles.pill}>
              <AspectIcons className={styles.pillAspects} aspects={l.card.Aspects} />
              {l.card.Name}
            </span>
          ))}
        </p>
      )}

      {step === 'format' ? (
        <section className={styles.formats} aria-label="Choose a format">
          {PLAY_FORMATS.map((f) => (
            <button key={f} type="button" className={styles.format} onClick={() => chooseFormat(f)}>
              <span className={styles.formatName}>{FORMAT_RULES[f].label}</span>
              <span className={styles.formatBlurb}>{FORMAT_BLURB[f]}</span>
            </button>
          ))}
        </section>
      ) : (
        <CardSearch
          // A fresh search per step, so a leader query doesn't carry into the base.
          key={step}
          sets={setList}
          mode={step === 'base' ? 'base' : 'leader'}
          format={format}
          pool={pool}
          deckAspects={[]}
          owned={owned}
          inDeck={() => 0}
          onAdd={() => {}}
          onChoose={step === 'base' ? chooseBase : chooseLeader}
          onCancelChoose={back}
          cancelLabel="Back"
          initialOwnedOnly={ownedOnly}
          onOwnedOnlyChange={setOwnedOnly}
        />
      )}
    </div>
  );
}
