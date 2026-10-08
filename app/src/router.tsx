import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';

import {
  loadedSets,
  manifestQuery,
  newestSetKey,
  prefetchOtherSets,
  preconQuery,
  setQuery,
} from '~/data/catalog';
import { binderEntries, readHiddenSets } from '~/data/binderSettings';
import { BinderRoute } from '~/routes/BinderRoute';
import { BulkPage } from '~/features/inventory/BulkPage';
import { readLastSet, readLastView } from '~/features/inventory/lastPlace';
import { isInventoryView, type InventoryView } from '~/features/inventory/views';
import { NARROW_QUERY } from '~/ui/useNarrow';
import { DeckEditRoute, DecksRoute, NewDeckRoute } from '~/routes/DecksRoute';
import { IntakePage } from '~/features/intake/IntakePage';
import { PutAwayPage } from '~/features/putAway/PutAwayPage';
import { ScanPage } from '~/features/scan/ScanPage';
import { AppShell } from '~/ui/AppShell';
import { Loader } from '~/ui/Loader';

/**
 * Routing exists so the app has addressable state. The legacy app held its view in
 * `useState<'binder' | 'decks'>`, so there was no URL for "SOR, page 12", no back button,
 * and nothing to link to. The scanner needs a real route regardless.
 */

export type RouterContext = { queryClient: QueryClient };

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/inventory' });
  },
});

/**
 * Phones open the Inventory tab on the List: the Binder is there too, one page at a time,
 * but the list is the quicker way in on a small screen.
 */
function defaultView(): InventoryView {
  return typeof window !== 'undefined' && window.matchMedia?.(NARROW_QUERY)?.matches
    ? 'list'
    : 'binder';
}

/**
 * The Inventory tab: wherever you last were in it — the set, and Binder, List or Bulk —
 * or, the first time (or if that set has since been hidden), the newest set with a binder.
 */
const inventoryIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inventory',
  beforeLoad: async ({ context }) => {
    const lastView = readLastView();
    if (lastView === 'bulk') throw redirect({ to: '/inventory/bulk' });
    const entries = await context.queryClient.ensureQueryData(manifestQuery());
    const visible = binderEntries(entries, await readHiddenSets());
    const lastSet = readLastSet();
    const key = visible.some((e) => e.key === lastSet) ? lastSet : newestSetKey(visible);
    throw redirect({
      to: '/inventory/$setKey/$view',
      params: { setKey: key ?? 'SOR', view: lastView ?? defaultView() },
    });
  },
});

const setViewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inventory/$setKey/$view',
  /**
   * `?card=` names the base number to select on arrival, which is what makes a binder
   * position linkable — "SOR, page 12, Vader selected" is a URL rather than transient
   * component state. Search params are untyped until validated, so an unvalidated one
   * would simply be dropped.
   */
  validateSearch: (search: Record<string, unknown>): { card?: number } => {
    const card = Number(search.card);
    return Number.isInteger(card) && card > 0 ? { card } : {};
  },
  loader: async ({ context, params }) => {
    if (!isInventoryView(params.view)) {
      throw redirect({
        to: '/inventory/$setKey/$view',
        params: { setKey: params.setKey, view: 'binder' },
      });
    }
    const entries = await context.queryClient.ensureQueryData(manifestQuery());
    const entry = entries.find((e) => e.key === params.setKey);
    if (!entry) throw redirect({ to: '/inventory' });
    // A set hidden from the binder has no pages; send its link to the default binder.
    const visible = binderEntries(entries, await readHiddenSets());
    if (!visible.some((e) => e.key === params.setKey)) throw redirect({ to: '/inventory' });

    // Only the active set is awaited; the rest warm in the background so first paint
    // never waits on them.
    const set = await context.queryClient.ensureQueryData(setQuery(entry));
    prefetchOtherSets(context.queryClient, entries, params.setKey);
    return { set, entries, view: params.view };
  },
  component: function SetViewRouteComponent() {
    const { set, entries, view } = setViewRoute.useLoaderData();
    const { card } = setViewRoute.useSearch();
    return <BinderRoute set={set} entries={entries} view={view} selectCard={card} />;
  },
});

/** Links from before the Inventory tab, e.g. `/binder/SOR?card=31`. */
const legacyBinderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/binder/$setKey',
  beforeLoad: ({ params, location }) => {
    throw redirect({
      to: '/inventory/$setKey/$view',
      params: { setKey: params.setKey, view: 'binder' },
      search: location.search,
    });
  },
});

/** Everything in the bulk box, across every set. */
const bulkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inventory/bulk',
  loader: async ({ context }) => {
    const entries = await context.queryClient.ensureQueryData(manifestQuery());
    await Promise.all(entries.map((entry) => context.queryClient.ensureQueryData(setQuery(entry))));
    return { entries };
  },
  component: function BulkRouteComponent() {
    const { entries } = bulkRoute.useLoaderData();
    const { queryClient } = bulkRoute.useRouteContext();
    return <BulkPage entries={entries} sets={loadedSets(queryClient, entries)} />;
  },
});

const decksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/decks',
  loader: async ({ context }) => {
    const entries = await context.queryClient.ensureQueryData(manifestQuery());
    // Deck check needs every set, so unlike the binder this route waits for all of them.
    await Promise.all(entries.map((entry) => context.queryClient.ensureQueryData(setQuery(entry))));
    const precons = await context.queryClient.ensureQueryData(preconQuery()).catch(() => []);
    return { entries, precons };
  },
  component: function DecksRouteComponent() {
    const { entries, precons } = decksRoute.useLoaderData();
    const { queryClient } = decksRoute.useRouteContext();
    return <DecksRoute sets={loadedSets(queryClient, entries)} precons={precons} />;
  },
});

/** The deck builder: format, leaders and base, then the editor. Static, so it wins over `$deckId`. */
const newDeckRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/decks/new',
  loader: async ({ context }) => {
    const entries = await context.queryClient.ensureQueryData(manifestQuery());
    await Promise.all(entries.map((entry) => context.queryClient.ensureQueryData(setQuery(entry))));
    return { entries };
  },
  component: function NewDeckRouteComponent() {
    const { entries } = newDeckRoute.useLoaderData();
    const { queryClient } = newDeckRoute.useRouteContext();
    return <NewDeckRoute sets={loadedSets(queryClient, entries)} />;
  },
});

/** One saved deck in the editor. */
const deckEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/decks/$deckId',
  loader: async ({ context }) => {
    const entries = await context.queryClient.ensureQueryData(manifestQuery());
    // The card lookup searches every set.
    await Promise.all(entries.map((entry) => context.queryClient.ensureQueryData(setQuery(entry))));
    return { entries };
  },
  component: function DeckEditRouteComponent() {
    const { entries } = deckEditRoute.useLoaderData();
    const { deckId } = deckEditRoute.useParams();
    const { queryClient } = deckEditRoute.useRouteContext();
    return <DeckEditRoute sets={loadedSets(queryClient, entries)} deckId={deckId} />;
  },
});

const intakeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/intake',
  loader: async ({ context }) => {
    const entries = await context.queryClient.ensureQueryData(manifestQuery());
    // A batch can hold cards from any set, and each line needs its set's printings.
    await Promise.all(entries.map((entry) => context.queryClient.ensureQueryData(setQuery(entry))));
    return { entries };
  },
  component: function IntakeRouteComponent() {
    const { entries } = intakeRoute.useLoaderData();
    const { queryClient } = intakeRoute.useRouteContext();
    return <IntakePage sets={loadedSets(queryClient, entries)} />;
  },
});

const scanRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/scan',
  loader: async ({ context }) => {
    const entries = await context.queryClient.ensureQueryData(manifestQuery());
    // A scan can be any card in any set: names, printings and binder slots come from here.
    await Promise.all(entries.map((entry) => context.queryClient.ensureQueryData(setQuery(entry))));
    return { entries };
  },
  component: function ScanRouteComponent() {
    const { entries } = scanRoute.useLoaderData();
    const { queryClient } = scanRoute.useRouteContext();
    return <ScanPage sets={loadedSets(queryClient, entries)} />;
  },
});

const putAwayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/put-away/$stackId',
  loader: async ({ context }) => {
    const entries = await context.queryClient.ensureQueryData(manifestQuery());
    // A stack can hold any set; filing needs every set's names and binder order.
    await Promise.all(entries.map((entry) => context.queryClient.ensureQueryData(setQuery(entry))));
    return { entries };
  },
  component: function PutAwayRouteComponent() {
    const { entries } = putAwayRoute.useLoaderData();
    const { stackId } = putAwayRoute.useParams();
    const { queryClient } = putAwayRoute.useRouteContext();
    return <PutAwayPage sets={loadedSets(queryClient, entries)} stackId={stackId} />;
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  inventoryIndexRoute,
  bulkRoute,
  setViewRoute,
  legacyBinderRoute,
  decksRoute,
  newDeckRoute,
  deckEditRoute,
  intakeRoute,
  scanRoute,
  putAwayRoute,
]);

/** `history` defaults to the browser's; tests pass an in-memory one. */
export function buildRouter(queryClient: QueryClient, history?: RouterHistory) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    // A route waiting on its sets shows the loader rather than a blank page. It appears
    // after a beat, so a quick load never flashes it, and stays long enough to read once
    // it does.
    defaultPendingComponent: () => <Loader label="Loading card data" />,
    defaultPendingMs: 250,
    defaultPendingMinMs: 600,
    ...(history && { history }),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof buildRouter>;
  }
}
