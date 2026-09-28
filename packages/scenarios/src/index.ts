import { aeroporto } from './catalog/aeroporto.js';
import { banco } from './catalog/banco.js';
import { clinica } from './catalog/clinica.js';
import { escola } from './catalog/escola.js';
import { folhaPagamento } from './catalog/folha-pagamento.js';
import { library } from './catalog/library.js';
import { onlineStore } from './catalog/online-store.js';
import { organograma } from './catalog/organograma.js';
import { streaming } from './catalog/streaming.js';
import type { Scenario } from './scenario.js';

// Data only. The answer checker lives in `@sqlscope/scenarios/check`, so that reading the
// catalog (e.g. in a server component) does not load the SQL engine and its WebAssembly.
export { VARIANTS, type Challenge, type Level, type Scenario } from './scenario.js';

export const scenarios: readonly Scenario[] = [
  onlineStore,
  library,
  escola,
  streaming,
  clinica,
  aeroporto,
  folhaPagamento,
  organograma,
  banco,
];

export const findScenario = (id: string): Scenario | undefined =>
  scenarios.find((scenario) => scenario.id === id);
