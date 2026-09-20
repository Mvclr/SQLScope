export { classify, type Classification, type StatementKind } from './classify.js';
export {
  fingerprint,
  loadParser,
  parseScript,
  type SqlSyntaxError,
  type Statement,
} from './parse.js';
export { createPositionMap, type PositionMap } from './positions.js';
