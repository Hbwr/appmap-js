import { basename, join } from 'path';
import nock from 'nock';
import sinon from 'sinon';
import fsextra from 'fs-extra';
import * as test from '../integration/setup';
import Command from '../../src/cli/scan/command';
import { fixtureAppMapFileName } from '../util';
import { readFileSync, unlinkSync } from 'fs';
import { ScanResults } from '../../src/report/scanResults';
import { copyFile, readFile, rm, stat, writeFile } from 'fs/promises';
import { Watcher } from '../../src/cli/scan/watchScan';
import { tmpdir } from 'os';
import { dump } from 'js-yaml';
import CommandOptions from '../../src/cli/scan/options';
import tmp from 'tmp-promise';
import assert from 'assert';
import { FSWatcher } from 'chokidar';
import { mkdir, chmod } from 'fs/promises';
import { asyncify, retry } from 'async';

process.env['APPMAP_TELEMETRY_DISABLED'] = 'true';
delete process.env.APPLAND_API_KEY;
delete process.env.APPLAND_URL;

const ReportFile = 'appmap-findings.json';
const AppId = test.AppId;
const DefaultScanConfigFilePath = join(__dirname, '..', '..', 'src', 'sampleConfig', 'default.yml');
const StandardOneShotScanOptions = {
  appmapFile: fixtureAppMapFileName(
    'org_springframework_samples_petclinic_owner_OwnerControllerTests_testInitCreationForm.appmap.json'
  ),
  config: DefaultScanConfigFilePath, // need to pass it explicitly
  reportFile: ReportFile,
  app: AppId,
  all: false,
  interactive: false,
  watch: false,
} as const;

function isError(error: unknown, code: string): boolean {
  const err = error as NodeJS.ErrnoException;
  return err.code === code;
}

afterEach(() => {
  try {
    unlinkSync(ReportFile);
  } catch (err) {
    if (!isError(err, 'ENOENT')) throw err;
  }
});
afterEach(() => sinon.restore());
afterEach(() => nock.cleanAll());

function runCommand(options: CommandOptions): Promise<void> {
  return Command.handler({ $0: 'test', _: [], ...options });
}

describe('scan', () => {
  it('errors with default options and without AppMap server API key', async () => {
    delete process.env.APPLAND_API_KEY;
    try {
      await runCommand(StandardOneShotScanOptions);
      throw new Error(`Expected this command to fail`);
    } catch (err) {
      expect((err as any).toString()).toMatch(/No API key available for AppMap server/);
    }
  });

  async function checkScan(options: CommandOptions): Promise<void> {
    await runCommand(options);

    const scanResults = JSON.parse(readFileSync(ReportFile).toString()) as ScanResults;
    expect(scanResults.summary).toBeTruthy();
    const appMapMetadata = scanResults.summary.appMapMetadata;
    expect(appMapMetadata.apps).toEqual(['spring-petclinic']);
    const checks = scanResults.configuration.checks;
    ['http-500', 'n-plus-one-query'].forEach((rule) =>
      expect(checks.map((check) => check.rule)).toContain(rule)
    );
    expect(Object.keys(scanResults).sort()).toEqual([
      'appMapMetadata',
      'checks',
      'configuration',
      'findings',
      'summary',
    ]);
  }

  it('runs with server access disabled', async () => {
    await checkScan({ ...StandardOneShotScanOptions, all: true });
  });

  it('errors when the provided appId is not valid', async () => {
    nock('http://localhost:3000').head(`/api/${AppId}`).reply(404);

    try {
      await runCommand(StandardOneShotScanOptions);
      throw new Error(`Expected this command to fail`);
    } catch (e) {
      expect((e as any).message).toMatch(
        /App "myorg\/sample_app_6th_ed" is not valid or does not exist./
      );
    }
  });

  it('integrates server finding status with local findings', async () => {
    const localhost = nock('http://localhost:3000');
    localhost.head(`/api/${AppId}`).reply(204).persist();
    localhost.get(`/api/${AppId}/finding_status`).reply(200, JSON.stringify([]));

    await runCommand(StandardOneShotScanOptions);
  });

  it('skips when encountering a bad file in a directory', async () =>
    tmp.withDir(
      async ({ path }) => {
        await copyFile(StandardOneShotScanOptions.appmapFile, join(path, 'good.appmap.json'));
        await writeFile(join(path, 'bad.appmap.json'), 'bad json');

        const options: CommandOptions = {
          ...StandardOneShotScanOptions,
          all: true,
          appmapDir: path,
        };
        delete options.appmapFile;

        await checkScan(options);
      },
      { unsafeCleanup: true }
    ));

  it('errors when no good files were found', async () =>
    tmp.withDir(
      async ({ path }) => {
        await writeFile(join(path, 'bad.appmap.json'), 'bad json');

        const options: CommandOptions = {
          ...StandardOneShotScanOptions,
          all: true,
          appmapDir: path,
        };
        delete options.appmapFile;

        expect.assertions(1);
        return runCommand(options).catch((e: Error) => {
          expect(e.message).toMatch(/Error processing/);
        });
      },
      { unsafeCleanup: true }
    ));

  it('errors when a bad file is explicitly provided', async () =>
    tmp.withFile(async ({ path }) => {
      await writeFile(path, 'bad json');
      const options = {
        ...StandardOneShotScanOptions,
        all: true,
        appmapFile: [path, StandardOneShotScanOptions.appmapFile],
      };
      expect.assertions(1);
      return runCommand(options).catch((e: Error) => {
        expect(e.message).toMatch(/Error processing/);
      });
    }));

  describe('watch mode', () => {
    let watcher: Watcher | undefined;
    let scanConfigFilePath: string;
    let tmpDir: string;

    const secretInLogMap = join(
      __dirname,
      '..',
      'fixtures',
      'appmaps',
      'secretInLog',
      'Confirmation_already_confirmed_user_should_not_be_able_to_confirm_the_account_again.appmap.json'
    );

    function findingsPath(mapPath: string): string {
      return join(indexPath(mapPath), 'appmap-findings.json');
    }

    function eventually<T>(fn: () => Promise<T>, intervalMs = 100, maxMs = 4000): Promise<T> {
      return new Promise((resolve, reject) => {
        let keepTrying = true;
        setTimeout(() => (keepTrying = false), maxMs).unref();

        const doTry = async function () {
          try {
            resolve(await fn());
          } catch (err) {
            if (keepTrying) setTimeout(doTry, intervalMs);
            else reject(err);
          }
        };

        doTry();
      });
    }

    function expectScan(mapPath: string): Promise<ScanResults> {
      const findingsFile = findingsPath(mapPath);
      return eventually(
        async () => JSON.parse((await readFile(findingsFile)).toString()) as ScanResults
      );
    }

    async function waitForSingleFinding(rule = 'secret-in-log'): Promise<ScanResults> {
      const findings = await expectScan(secretInLogMap);
      expect(findings.findings.length).toEqual(1);
      expect(findings.findings[0].ruleId).toEqual(rule);
      return findings;
    }

    function copyAppMap(source: string, targetName?: string): Promise<void> {
      targetName ||= basename(source);
      return fsextra.copy(source, join(tmpDir, targetName));
    }

    function indexPath(mapPath: string): string {
      return join(tmpDir, basename(mapPath, '.appmap.json'));
    }

    async function createIndex(mapPath: string): Promise<void> {
      const index = indexPath(mapPath);
      await retry(asyncify(() => fsextra.mkdir(index, { recursive: true })));
      await writeFile(join(index, 'mtime'), Date.now().toString());
    }

    beforeEach(async () => {
      tmpDir = await fsextra.mkdtemp(tmpdir() + '/');
      scanConfigFilePath = join(tmpDir, 'appmap-scanner.yml');
      await fsextra.copy(DefaultScanConfigFilePath, scanConfigFilePath);

      await copyAppMap(secretInLogMap);
    });

    async function createWatcher(): Promise<void> {
      watcher = new Watcher({
        appId: 'no-such-app',
        appmapDir: tmpDir,
        configFile: scanConfigFilePath,
      });
      await watcher.watch();

      // takes a moment to kick in for some reason
      return new Promise((resolve) => setTimeout(resolve, 100));
    }

    afterEach(async () => {
      if (watcher) watcher.close();
      watcher = undefined;

      fsextra.rm(tmpDir, { recursive: true });
    });

    it('scans already indexed AppMaps on start', async () => {
      await createIndex(secretInLogMap);
      await createWatcher();
      await waitForSingleFinding();
    });

    it('scans AppMaps when the mtime file is created or changed', async () => {
      await createWatcher();

      await createIndex(secretInLogMap);
      await waitForSingleFinding();
    });

    it('does not raise if it hits the limit of the number of file watchers', async () => {
      await createWatcher();
      if (watcher) {
        // without the if it doesn't compile; it could be undefined
        watcher.appmapWatcher = new FSWatcher();
        expect(watcher.appmapWatcher).not.toBeUndefined();
        const err = new Error('ENOSPC: System limit for number of file watchers reached');
        (err as NodeJS.ErrnoException).code = 'ENOSPC';
        await watcher.watcherErrorFunction(err);
        expect(watcher.appmapWatcher).toBeUndefined();
      } else throw new Error('watcher should have been defined');
    });

    it('eventually rescans even if file watching is flaky', async () => {
      await createWatcher();
      watcher?.appmapWatcher?.removeAllListeners();

      await createIndex(secretInLogMap);
      await waitForSingleFinding();
    });

    it('does not raise on EACCES: permission denied', async () => {
      await createIndex(secretInLogMap);
      const permissionDeniedDir = join(tmpDir, 'permission_denied_dir');
      await mkdir(permissionDeniedDir);
      await fsextra.copy(secretInLogMap, join(permissionDeniedDir, basename(secretInLogMap)));
      await chmod(permissionDeniedDir, 0o000);
      await createWatcher();
      await waitForSingleFinding();
      await chmod(permissionDeniedDir, 0o777); // else the next testcase fails
    });

    it('reloads the scanner configuration automatically @appmap-fixme', async () => {
      await createWatcher();
      await createIndex(secretInLogMap);

      await expectScan(secretInLogMap);

      await rm(findingsPath(secretInLogMap));
      await writeFile(scanConfigFilePath, dump({ checks: [{ rule: 'http-500' }] }));

      const delays = [0.001, 0.01, 0.1];
      let findings: ScanResults | undefined;
      for (let i = 0; i < delays.length; i++) {
        const delay = delays[i];
        await new Promise((resolve) => {
          setTimeout(resolve, delay);
        });
        await createIndex(secretInLogMap);
        findings = await expectScan(secretInLogMap);
        if (findings.checks.length === 1) break;
      }

      assert(findings);
      expect(findings.checks.length).toEqual(1);
      expect(findings.checks[0].rule.id).toEqual('http-500');
    });

    it('picks up mtime changes after a relative directory is removed and recreated', async () => {
      await createWatcher();
      await createIndex(secretInLogMap);
      await waitForSingleFinding();

      await rm(indexPath(secretInLogMap), { recursive: true });
      await createIndex(secretInLogMap);
      await waitForSingleFinding();
    });

    it('does not rescan when not needed, but scans every new file @appmap-fixme', async () => {
      /* Note, this test also makes sure we continue scanning after
       * we skip some files due to them being up to date. */
      await createWatcher();
      const src = secretInLogMap;

      // first, scan two appmaps
      await createIndex(secretInLogMap);
      await expectScan(secretInLogMap);

      const other = 'other.appmap.json';
      await copyAppMap(src, other);
      await createIndex(other);
      await expectScan(other);

      // store the finding file mtimes, we'll check later if they aren't rescanned
      const getTimes = (...paths: string[]) =>
        Promise.all(paths.map((f) => stat(findingsPath(f)).then((s) => s.mtimeMs)));
      const times = await getTimes(src, other);

      // touch both
      await Promise.all([src, other].map(createIndex));

      // now scan some unrelated maps
      const names = [...Array(5).keys()].map((i) => `test-${i}.appmap.json`);
      await Promise.all(names.map((f) => copyAppMap(src, f)));
      await Promise.all(names.map(createIndex));
      await Promise.all(names.map(expectScan));

      // check the previous ones to make sure they haven't been rescanned
      expect(await getTimes(src, other)).toStrictEqual(times);
    });
  });
});
