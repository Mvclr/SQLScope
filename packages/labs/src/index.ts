import { sqlInjection } from './catalog/injection.js';
import { rolesAndPermissions } from './catalog/privileges.js';
import { rowLevelSecurity } from './catalog/rls.js';
import type { Lab } from './lab.js';

// Data only, like the scenarios: reading the catalog must not pull in an engine.
export type { Lab, LabPanel, LabStep, Level } from './lab.js';

export const labs: readonly Lab[] = [sqlInjection, rolesAndPermissions, rowLevelSecurity];

export const findLab = (id: string): Lab | undefined => labs.find((lab) => lab.id === id);
