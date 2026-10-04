import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only auto-cleans when vitest runs with `globals: true`. This config
// does not, so unmount explicitly — otherwise every render accumulates in the document
// and queries start matching elements from previous tests.
afterEach(cleanup);

// jsdom implements no layout, so `scrollIntoView` is absent entirely. Components that
// keep a focused item visible would throw without it; tests that care about the call
// spy on this stub.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
