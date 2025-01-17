import { Event } from '@appland/models';
import { forClientRequest, breakingChanges } from '../openapi';
import { MatchResult, Rule, RuleLogic } from '../types';
import * as types from './types';
import OpenApiDiff from 'openapi-diff';
import { OpenAPIV3 } from 'openapi-types';
import parseRuleDescription from './lib/parseRuleDescription';
import openapiProvider from './lib/openapiProvider';
import assert from 'assert';

class Options implements types.IncompatibleHttpClientRequest.Options {
  public schemata: Record<string, string> = {};
}

const changeMessage = (change: OpenApiDiff.DiffResult<'breaking'>): string => {
  return `HTTP client request is incompatible with OpenAPI schema. Change details: ${
    change.action
  } ${change.sourceSpecEntityDetails
    .concat(change.destinationSpecEntityDetails)
    .map((detail) => detail.location)
    .join(', ')}`;
};

function build(options: Options): RuleLogic {
  async function matcher(event: Event): Promise<MatchResult[]> {
    const clientFragment = forClientRequest(event);
    assert(event.httpClientRequest);
    if (!event.httpClientRequest.url) return [];

    const host = new URL(event.httpClientRequest.url).host;
    const serverSchema = await openapiProvider(host, options.schemata);
    const clientSchema = {
      openapi: '3.0.0',
      info: {
        title: 'Schema derived from client request',
        version: serverSchema.info.version, // Indicate that it *should* be compatible.
      },
      paths: clientFragment!.paths,
      components: { securitySchemes: clientFragment!.securitySchemes },
    } as OpenAPIV3.Document;
    const changes = await breakingChanges(clientSchema, serverSchema);
    return changes.map((change: OpenApiDiff.DiffResult<'breaking'>) => ({
      event,
      message: changeMessage(change),
    }));
  }

  return {
    matcher,
    where: (e: Event) => !!e.httpClientRequest && !!e.httpClientRequest!.url,
  };
}

export default {
  id: 'incompatible-http-client-request',
  title: 'Incompatible HTTP client request',
  // scope: //http_client_request
  scope: 'http_client_request',
  enumerateScope: false,
  impactDomain: 'Stability',
  description: parseRuleDescription('incompatibleHttpClientRequest'),
  url: 'https://appland.com/docs/analysis/rules-reference.html#incompatible-http-client-request',
  Options,
  build,
} as Rule;
