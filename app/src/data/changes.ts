import type { SetKey } from '~/domain/types';

/**
 * Local-write notifications.
 *
 * The sync layer needs to know when something changed locally, but must not react to
 * writes it made itself while applying a server value — that would push straight back and
 * loop. Rather than inferring intent from a database observer, mutations announce
 * themselves explicitly, and remote applies simply stay silent.
 */

type SetListener = (setKey: SetKey) => void;
type VoidListener = () => void;

const inventoryListeners = new Set<SetListener>();
const deckListeners = new Set<VoidListener>();

export function onInventoryChanged(listener: SetListener): () => void {
  inventoryListeners.add(listener);
  return () => void inventoryListeners.delete(listener);
}

export function notifyInventoryChanged(setKey: SetKey): void {
  for (const listener of inventoryListeners) listener(setKey);
}

export function onDeckLibraryChanged(listener: VoidListener): () => void {
  deckListeners.add(listener);
  return () => void deckListeners.delete(listener);
}

export function notifyDeckLibraryChanged(): void {
  for (const listener of deckListeners) listener();
}

/** Test helper: drop every listener so suites do not leak into one another. */
export function resetChangeListeners(): void {
  inventoryListeners.clear();
  deckListeners.clear();
}
