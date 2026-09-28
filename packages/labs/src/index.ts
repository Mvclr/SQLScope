import { comentariosSql } from './catalog/comentarios.js';
import { sqlInjection } from './catalog/injection.js';
import { sqlInjectionApp } from './catalog/injection-app.js';
import { privilegiosBasicos } from './catalog/privileges-basico.js';
import { rolesAndPermissions } from './catalog/privileges.js';
import { propriedadeDeTabelas } from './catalog/propriedade.js';
import { rlsRestritiva } from './catalog/rls-restritiva.js';
import { rowLevelSecurity } from './catalog/rls.js';
import { securityDefiner } from './catalog/security-definer.js';
import type { Lab } from './lab.js';

// Data only, like the scenarios: reading the catalog must not pull in an engine.
export type { Lab, LabPanel, LabStep, Level } from './lab.js';
export { buildSearch, type BuiltQuery, type SearchMode } from './search.js';

export const labs: readonly Lab[] = [
  privilegiosBasicos,
  comentariosSql,
  propriedadeDeTabelas,
  sqlInjection,
  sqlInjectionApp,
  rolesAndPermissions,
  rowLevelSecurity,
  securityDefiner,
  rlsRestritiva,
];

export const findLab = (id: string): Lab | undefined => labs.find((lab) => lab.id === id);
