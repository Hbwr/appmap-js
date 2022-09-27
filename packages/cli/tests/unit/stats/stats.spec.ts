import path from 'path';
const fixtureDir = path.join(__dirname, '../', 'fixtures', 'stats');
const StatsCommand = require('../../../src/cmds/stats/stats');
import { SortedAppMapSize } from '../../../src/cmds/stats/types/appMapSize';
import { SlowestExecutionTime } from '../../../src/cmds/stats/types/functionExecutionTime';

describe('stats subcommand', () => {
  it('works', async () => {
    let argv = {
      _: ['stats'],
      $0: 'src/cli.ts',
      directory: fixtureDir,
      d: fixtureDir,
    };

    const ret = await StatsCommand.handler(argv);
    let biggestAppMapSizes: SortedAppMapSize[] = ret[0];
    let slowestExecutionTimes: SlowestExecutionTime[] = ret[1];
    expect(biggestAppMapSizes[0].size).toEqual(1747637);
    expect(biggestAppMapSizes[0].name.split('/').reverse()[0]).toEqual(
      'Microposts_interface_micropost_interface.appmap.json'
    );
    expect(slowestExecutionTimes[0].elapsed_instrumentation_time_total).toEqual(
      0.020088
    );
    expect(slowestExecutionTimes[0].num_calls).toEqual(449);
    expect(slowestExecutionTimes[0].name).toEqual(
      'function:logger/Logger::LogDevice#write'
    );
  });
});