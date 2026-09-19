import { library } from './catalog/library.js';
import { onlineStore } from './catalog/online-store.js';
import type { Scenario } from './scenario.js';

// Data only. The answer checker lives in `@sqlscope/scenarios/check`, so that reading the
// catalog (e.g. in a server component) does not load the SQL engine and its WebAssembly.
export { VARIANTS, type Challenge, type Level, type Scenario } from './scenario.js';

export const scenarios: readonly Scenario[] = [onlineStore, library];

export const findScenario = (id: string): Scenario | undefined =>
  scenarios.find((scenario) => scenario.id === id);
