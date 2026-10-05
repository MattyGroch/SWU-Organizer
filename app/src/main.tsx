import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { startSync } from './data/sync';
import { SyncProvider } from './features/account/SyncProvider';
import { buildRouter } from './router';
import { ToastProvider } from './ui/Toasts';
import './styles/global.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Set data is static between CI data refreshes; refetching on every window focus
      // would re-parse megabytes of JSON for nothing.
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const router = buildRouter(queryClient);

// Queues local writes from the first paint. Nothing is transmitted until sign-in, but
// queued writes persist, so an offline session loses nothing.
const sync = startSync(queryClient);

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

// The service worker makes the installed app open and scan offline. Production only: in
// development it would serve stale modules over Vite's live reload.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
      console.warn('Service worker registration failed', error);
    });
  });
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SyncProvider bundle={sync}>
          <RouterProvider router={router} />
        </SyncProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
