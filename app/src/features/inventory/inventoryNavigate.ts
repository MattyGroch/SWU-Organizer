import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { useSharedCollection } from '~/data/shared';
import type { SetKey } from '~/domain/types';

import type { InventoryView } from './views';

/**
 * Places in the Inventory tab. The same pages serve your own collection (`/inventory/…`)
 * and a share link (`/share/<token>/…`), so links name a place and these resolve it to
 * whichever one is on screen. That keeps a visitor inside the share.
 */
export type InventoryTarget =
  | { place: 'set'; setKey: SetKey; view: InventoryView; card?: number }
  | { place: 'bulk' }
  | { place: 'stats' }
  /** Wherever the tab opens: your last place, or the share's newest set. */
  | { place: 'home' };

/** `navigate`, for a place in whichever collection is on screen. */
export function useInventoryNavigate() {
  const navigate = useNavigate();
  const token = useSharedCollection()?.token;
  return useCallback(
    (target: InventoryTarget, options: { replace?: boolean } = {}) => {
      const { replace } = options;
      if (token === undefined) {
        switch (target.place) {
          case 'set':
            return navigate({
              to: '/inventory/$setKey/$view',
              params: { setKey: target.setKey, view: target.view },
              // `search: {}` when no card: the router keeps search params by default, and a
              // stale `?card=` would select an unrelated card in the set you moved to.
              search: target.card === undefined ? {} : { card: target.card },
              replace,
            });
          case 'bulk':
            return navigate({ to: '/inventory/bulk', replace });
          case 'stats':
            return navigate({ to: '/inventory/stats', replace });
          case 'home':
            return navigate({ to: '/inventory', replace });
        }
      }
      switch (target.place) {
        case 'set':
          return navigate({
            to: '/share/$token/$setKey/$view',
            params: { token, setKey: target.setKey, view: target.view },
            search: target.card === undefined ? {} : { card: target.card },
            replace,
          });
        case 'bulk':
          return navigate({ to: '/share/$token/bulk', params: { token }, replace });
        case 'stats':
          return navigate({ to: '/share/$token/stats', params: { token }, replace });
        case 'home':
          return navigate({ to: '/share/$token', params: { token }, replace });
      }
    },
    [navigate, token],
  );
}
