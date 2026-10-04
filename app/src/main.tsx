import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { startSync } from './data/sync';
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
startSync(queryClient);

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
