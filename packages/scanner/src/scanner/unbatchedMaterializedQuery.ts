import { buildQueryAST, Event } from '@appland/models';
import { AssertionSpec } from '../types';
import Assertion from '../assertion';
import { visit } from '../database/visit';

function isMaterialized(e: Event): boolean {
  return e.ancestors().some(({ labels }) => labels.has(DAOMaterialize));
}

function isApplicable(e: Event): boolean {
  try {
    const ast = buildQueryAST(e.sqlQuery!);
    let isSelect = false;
    let isCount = false;
    let hasLimitClause = false;
    let isMetadataQuery = false;

    if (ast) {
      const metadataTableNames = ['sqlite_master'];

      visit(ast, {
        'statement.select': (statement: any) => {
          isSelect = true;

          if (
            statement.result &&
            Array.isArray(statement.result) &&
            statement.result.length === 1 &&
            statement.result[0].type === 'function' &&
            statement.result[0].name.name === 'count'
          ) {
            isCount = true;
          }
        },
        'expression.limit': () => {
          hasLimitClause = true;
        },
        'identifier.table': (identifier: any) => {
          if (metadataTableNames.includes(identifier.name)) {
            isMetadataQuery = true;
          }
        },
      });
    }

    const isBatched = hasLimitClause || isCount || isMetadataQuery;

    return isSelect && !isBatched && isMaterialized(e);
  } catch (_) {
    console.warn(`Unable to analyze query "${e.sqlQuery!}"`);
    return false;
  }
}

function scanner(): Assertion {
  return Assertion.assert(
    'unbatched-materialized-query',
    'Unbatched materialized SQL query',
    (e: Event) => isApplicable(e),
    (assertion: Assertion): void => {
      assertion.where = (e: Event) => !!e.sqlQuery;
      assertion.description = `Unbatched materialized SQL query`;
    }
  );
}

// Example: ActiveRecord::Relation#records
const DAOMaterialize = 'dao.materialize';

export default {
  labels: [DAOMaterialize],
  scope: 'command',
  enumerateScope: true,
  scanner,
} as AssertionSpec;