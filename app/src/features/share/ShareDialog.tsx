import { useEffect, useRef, useState } from 'react';

import { readHiddenSets } from '~/data/binderSettings';
import { createMyShare, fetchMyShare, revokeMyShare, shareUrl, type MyShare } from '~/data/shared';
import dialogStyles from '~/features/binder/BinderDialog.module.css';

import styles from './ShareDialog.module.css';

/**
 * Your share link: a read-only view of your binders, list, bulk box and stats that anyone
 * with the link can open, no sign-in needed. It shows the collection as it is now, not a
 * copy, and the sets you've hidden stay hidden.
 */
export function ShareDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  /** `undefined` while checking; `null` when not sharing. */
  const [share, setShare] = useState<MyShare | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    let live = true;
    fetchMyShare()
      .then((found) => live && setShare(found))
      .catch((error: unknown) => {
        if (!live) return;
        setShare(null);
        setStatus(error instanceof Error ? error.message : 'Couldn’t check your share link.');
      });
    return () => {
      live = false;
    };
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setStatus('');
    try {
      await action();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const make = (message: string) =>
    run(async () => {
      setShare(await createMyShare(await readHiddenSets()));
      setStatus(message);
    });

  const stop = () =>
    run(async () => {
      await revokeMyShare();
      setShare(null);
      setStatus('Sharing is off. The old link no longer works.');
    });

  const send = (url: string) =>
    run(async () => {
      if (navigator.share) {
        try {
          await navigator.share({ title: 'My SWU collection', url });
          return;
        } catch (error) {
          // Cancelling the share sheet is not a failure.
          if (error instanceof DOMException && error.name === 'AbortError') return;
        }
      }
      await navigator.clipboard.writeText(url);
      setStatus('Link copied.');
    });

  const url = share ? shareUrl(share.token) : '';

  return (
    <dialog
      ref={dialogRef}
      className={dialogStyles.dialog}
      onClose={onClose}
      aria-labelledby="share-title"
    >
      <h2 id="share-title" className={dialogStyles.title}>
        Share collection
      </h2>
      <p className={dialogStyles.note}>
        Anyone with the link can look through your binders, list, bulk box and stats. They can’t
        change anything, and they always see it as it is now.
      </p>

      <div className={dialogStyles.choices}>
        {share === undefined ? (
          <p className={dialogStyles.status}>Checking…</p>
        ) : share === null ? (
          <button
            type="button"
            className={dialogStyles.button}
            disabled={busy}
            onClick={() => void make('Your link is ready.')}
          >
            Make a share link
          </button>
        ) : (
          <>
            <label className={styles.url}>
              <span className="visually-hidden">Share link</span>
              <input
                type="text"
                readOnly
                value={url}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
            <button
              type="button"
              className={dialogStyles.button}
              disabled={busy}
              onClick={() => void send(url)}
            >
              {typeof navigator.share === 'function' ? 'Share link…' : 'Copy link'}
            </button>
            <button
              type="button"
              className={dialogStyles.button}
              disabled={busy}
              onClick={() => void make('New link made. The old one no longer works.')}
            >
              Make a new link
            </button>
            <button
              type="button"
              className={dialogStyles.button}
              disabled={busy}
              onClick={() => void stop()}
            >
              Stop sharing
            </button>
          </>
        )}
        <p role="status" className={dialogStyles.status}>
          {status}
        </p>
      </div>

      <div className={dialogStyles.footer}>
        <button
          type="button"
          className={dialogStyles.button}
          onClick={() => dialogRef.current?.close()}
        >
          Close
        </button>
      </div>
    </dialog>
  );
}
