import { join } from 'path';

import { promises as fsp } from 'fs';
import { readFile } from 'fs/promises';
import yaml, { load } from 'js-yaml';
import { OpenAPIV3 } from 'openapi-types';
import { verbose } from '@appland/openapi';
import { Arguments, Argv, number } from 'yargs';

import { locateAppMapDir } from '../lib/locateAppMapDir';
import { handleWorkingDirectory } from '../lib/handleWorkingDirectory';
import { locateAppMapConfigFile } from '../lib/locateAppMapConfigFile';
import Telemetry, { Git, GitState } from '../telemetry';
import { findRepository } from '../lib/git';
import { DefaultMaxAppMapSizeInMB, fileSizeFilter } from '../lib/fileSizeFilter';

export type FilterFunction = (file: string) => Promise<{ enable: boolean; message?: string }>;

async function loadTemplate(fileName: string): Promise<any> {
  if (!fileName) {
    // eslint-disable-next-line no-param-reassign
    fileName = join(__dirname, '../../resources/openapi-template.yaml');
  }
  return yaml.load((await fsp.readFile(fileName)).toString());
}

export default {
  command: 'openapi',
  OpenAPICommand,
  aliases: ['swagger'],
  describe: 'Generate OpenAPI from AppMaps in a directory',
  builder(args: Argv) {
    args.option('directory', {
      describe: 'program working directory',
      type: 'string',
      alias: 'd',
    });
    args.option('appmap-dir', {
      describe: 'directory to recursively inspect for AppMaps',
    });
    args.option('max-size', {
      describe: 'maximum AppMap size that will be processed, in filesystem-reported MB',
      default: `${DefaultMaxAppMapSizeInMB}mb`,
    });
    args.option('output-file', {
      alias: ['o'],
      describe: 'output file name',
      requiresArg: true,
    });
    args.option('openapi-template', {
      describe:
        'template YAML; generated content will be placed in the paths and components sections',
    });
    args.option('openapi-title', {
      describe: 'info/title field of the OpenAPI document',
    });
    args.option('openapi-version', {
      describe: 'info/version field of the OpenAPI document',
    });
    return args.strict();
  },
  async handler(argv: Arguments | any) {
    verbose(argv.verbose);
    handleWorkingDirectory(argv.directory);
    const appmapDir = await locateAppMapDir(argv.appmapDir);
    const { openapiTitle, openapiVersion, maxSize } = argv;
    const maxAppMapSizeInBytes = Math.round(parseFloat(maxSize) * 1024 * 1024);

    function tryConfigure(path: string, fn: () => void) {
      try {
        fn();
      } catch {
        console.warn(`Warning: unable to configure OpenAPI field ${path}`);
      }
    }

    const appmapConfigFile = await locateAppMapConfigFile(appmapDir);

    const cmd = new OpenAPICommand(appmapDir);
    cmd.filter = fileSizeFilter(maxAppMapSizeInBytes);
    const [openapi, numAppMaps] = await cmd.execute();
    sendTelemetry(openapi.paths, numAppMaps, appmapDir);

    for (const error of cmd.errors) {
      console.warn(error);
    }

    const template = await loadTemplate(argv.openapiTemplate);
    template.paths = openapi.paths;

    if (openapiTitle) {
      tryConfigure('info.title', () => {
        template.info.title = openapiTitle;
      });
    }
    if (openapiVersion) {
      tryConfigure('info.version', () => {
        template.info.version = openapiVersion;
      });
    }

    // TODO: This should be made available, but isn't
    template.components = (openapi as any).components;
    template.components ||= {};

    let appmapConfig: Record<string, any> | undefined;
    if (appmapConfigFile) {
      appmapConfig = (load(await readFile(appmapConfigFile, 'utf-8')) || {}) as any;
    }

    const overrides = appmapConfig?.openapi?.overrides;
    const schemas = appmapConfig?.openapi?.schemas;
    if (schemas) template.components.schemas = schemas;
    if (overrides) applySchemaOverrides(template.paths, overrides);
    if (template.paths) sortProperties(template.paths);

    const fileContents = `# This document can be generated with the following command: 
# npx @appland/appmap@latest openapi
#
# NOTE: You will need Node.js installed on your machine to run the above command
#
# Some helpful options:
#   --output-file        output file name
#   --openapi-title      title field of the OpenAPI document
#   --openapi-version    version field of the OpenAPI document
#
# For more info, run:
# npx @appland/appmap@latest openapi --help
#
# Visit our docs: https://appmap.io/docs/openapi.html
#
${yaml.dump(template)}
`;
    if (argv.outputFile) {
      await fsp.writeFile(argv.outputFile, fileContents);
    } else {
      console.log(fileContents);
    }
  },
};

async function sendTelemetry(paths: OpenAPIV3.PathsObject, numAppMaps: number, appmapDir: string) {
  const gitState = GitState[await Git.state(appmapDir)];
  const contributors = (await Git.contributors(60, appmapDir)).length;
  Telemetry.sendEvent(
    {
      name: 'appmap:openapi',
      properties: {
        git_state: gitState,
        'appmap.version_control.repository': await warnCatch(findRepository(appmapDir)),
      },
      metrics: {
        paths: Object.keys(paths).length,
        contributors,
        numAppMaps,
      },
    },
    { includeEnvironment: true }
  );
}

function sortProperties(values: Record<string, any>): void {
  Object.keys(values).forEach((key) => {
    let value = values[key];
    if (key === 'properties' && typeof value === 'object') {
      values[key] = Object.keys(value)
        .sort()
        .reduce((memo, key) => {
          const v = value[key];
          if (typeof v === 'object' && v !== null && v.constructor !== Array) sortProperties(v);
          memo[key] = v;
          return memo;
        }, {});
    } else if (typeof value === 'object' && value !== null) {
      sortProperties(value);
    }
  });
}

function applySchemaOverrides(paths: Record<string, any>, overrides: Record<string, any>) {
  Object.keys(overrides).forEach((key) => {
    const value = overrides[key];
    if (value === undefined) return;

    if (paths[key] == undefined) return;

    if (key === 'schema') {
      paths.schema = { ...overrides.schema };
    } else if (typeof value === 'object') {
      applySchemaOverrides(paths[key], value);
    }
  });
}

async function warnCatch<T>(fn: Promise<T | undefined>): Promise<T | undefined> {
  try {
    return await fn;
  } catch (err) {
    console.warn(err);
    return;
  }
}
