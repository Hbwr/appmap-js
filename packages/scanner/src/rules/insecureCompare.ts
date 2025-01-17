import { Event } from '@appland/models';
import { URL } from 'url';
import recordSecrets, { Secret } from '../analyzer/recordSecrets';
import { looksSecret } from '../analyzer/secretsRegexes';
import { Rule, RuleLogic } from '../types.d';
import parseRuleDescription from './lib/parseRuleDescription';

const BCRYPT_REGEXP = /^[$]2[abxy]?[$](?:0[4-9]|[12][0-9]|3[01])[$][./0-9a-zA-Z]{53}$/;

const secrets: Secret[] = [];
const secretStrings = new Set<string>();

function stringEquals(e: Event): boolean {
  if (!e.parameters || !e.receiver || e.parameters!.length !== 1) {
    return false;
  }

  const args = [e.receiver.value, e.parameters[0].value];

  function isBcrypt(str: string): boolean {
    return BCRYPT_REGEXP.test(str);
  }

  function isSecret(str: string): boolean {
    return secretStrings.has(str) || looksSecret(str);
  }

  // BCrypted strings are safe to compare using equals()
  return args.some(isSecret) && !args.some(isBcrypt);
}

function build(): RuleLogic {
  function matcher(e: Event) {
    if (e.codeObject.labels.has(Secret)) {
      const numSecrets = secrets.length;
      recordSecrets(secrets, e);
      for (let index = numSecrets; index < secrets.length; index++) {
        const secret = secrets[index];
        secretStrings.add(secret.value);
      }
    }
    if (e.codeObject.labels.has(StringEquals)) {
      return stringEquals(e);
    }
  }

  function where(e: Event): boolean {
    return (
      e.isFunction && (e.codeObject.labels.has(StringEquals) || e.codeObject.labels.has(Secret))
    );
  }

  return {
    matcher,
    where,
  };
}

const Secret = 'secret';
const StringEquals = 'string.equals';

export default {
  id: 'insecure-compare',
  title: 'Insecure comparison of secrets',
  labels: [Secret, StringEquals],
  enumerateScope: true,
  impactDomain: 'Security',
  references: {
    'CWE-208': new URL('https://cwe.mitre.org/data/definitions/208.html'),
  },
  description: parseRuleDescription('insecureCompare'),
  url: 'https://appland.com/docs/analysis/rules-reference.html#insecure-compare',
  build,
} as Rule;
