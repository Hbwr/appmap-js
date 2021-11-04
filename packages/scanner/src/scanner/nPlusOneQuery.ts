import { Event } from '@appland/models';
import { AssertionSpec, Level, MatchResult } from '../types';
import Assertion from '../assertion';
import { SQLCount, sqlStrings } from '../database';

class Options {
  constructor(public warningLimit = 5, public errorLimit = 10, public whitelist: string[] = []) {}
}

// TODO: clean up according to https://github.com/applandinc/scanner/issues/43
function scanner(options: Options = new Options()): Assertion {
  const sqlCount: Record<string, SQLCount> = {};

  const matcher = (command: Event): MatchResult[] | undefined => {
    for (const sqlEvent of sqlStrings(command)) {
      let occurrence = sqlCount[sqlEvent.sql];
      if (!occurrence) {
        occurrence = {
          count: 1,
          events: [sqlEvent.event],
        };
        sqlCount[sqlEvent.sql] = occurrence;
      } else {
        occurrence.count += 1;
        occurrence.events.push(sqlEvent.event);
      }
    }

    return Object.keys(sqlCount).reduce((matchResults, sql) => {
      const occurrence = sqlCount[sql];

      const buildMatchResult = (level: Level): MatchResult => {
        return {
          level: level,
          event: occurrence.events[0],
          message: `${occurrence.count} occurrences of SQL "${sql}"`,
          relatedEvents: occurrence.events,
        };
      };

      if (occurrence.count >= options.errorLimit) {
        matchResults.push(buildMatchResult('error'));
      } else if (occurrence.count >= options.warningLimit) {
        matchResults.push(buildMatchResult('warning'));
      }
      return matchResults;
    }, [] as MatchResult[]);
  };

  return Assertion.assert(
    'n-plus-one-query',
    'N+1 SQL queries',
    matcher,
    (assertion: Assertion): void => {
      assertion.description = `SQL query should not be repeated within the same command`;
    }
  );
}

export default { scope: 'command', enumerateScope: false, Options, scanner } as AssertionSpec;
