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
import { isInventoryView, type InventoryView } from '~/features/inventory/views';
import { NARROW_QUERY } from '~/ui/useNarrow';
import { DecksRoute } from '~/routes/DecksRoute';
import { IntakePage } from '~/features/intake/IntakePage';
import { PutAwayPage } from '~/features/putAway/PutAwayPage';
import { ScanPage } from '~/features/scan/ScanPage';
import { AppShell } from '~/ui/AppShell';

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

/** Phones have no binder grid, so they land on the list instead. */
function defaultView(): InventoryView {
  return typeof window !== 'undefined' && window.matchMedia?.(NARROW_QUERY)?.matches
    ? 'list'
    : 'binder';
}

/** The Inventory tab: the newest set with a binder. */
const inventoryIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inventory',
  beforeLoad: async ({ context }) => {
    const entries = await context.queryClient.ensureQueryData(manifestQuery());
    const key = newestSetKey(binderEntries(entries, await readHiddenSets()));
    throw redirect({
      to: '/inventory/$setKey/$view',
      params: { setKey: key ?? 'SOR', view: defaultView() },
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
    ...(history && { history }),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof buildRouter>;
  }
}
