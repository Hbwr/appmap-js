# AppMap Scanner

Code scanning, linting, assertions and alerts.

Provides consistent ways to filter (include and exclude) the AppMap events and property values.

# Rule configuration

## Event filters

Two standard event filters are provided that can be used with every rule: `include` and `exclude`.
These filters are applied to an event, and make a determination about whether or not that event
should be checked by the rule.

An event filter can be applied in one of two ways:

- `scope` the entire scope - for example, `http_server_request`, `command`.
- `event` an individual event within a scope. When `enumerateScope` is true for a rule, the event
  filters are applied automatically by the scanner framework. When `enumerateScope` is false, the
  rule code must apply the filter itself.

The event filter consists of a property name and a test. The framework fetches the property value
from the event, and then applies the test. The test can be one of three types:

- `equal` - value string matches the filter condition exactly.
- `include` - value string includes the filter condition.
- `match` - value string matches the filter condition regexp.

Here's an example of a rule configured with a custom `include` event filter. The event filter
prevents the rule from being applied to SQL queries that include the fragment
`FROM "pg_class" INNER JOIN "pg_attribute"` (because these queries are fetching ORM metadata, not
application code).

```yaml
- id: tooManyJoins
  exclude:
    - event:
        property: query
        test:
          include: FROM "pg_class" INNER JOIN "pg_attribute"
```

## Pattern filters

A second type of filter is pattern filter. Pattern filters are provided by rules that need, or
benefit from, specific configuration.

Like Event filters, a pattern filter uses `equal`, `include`, or `match`. The data to which the
pattern filter is applied depends on the particulars of the rule. For example, this pattern filter
finds slow function calls within a specific package:

```yaml
- id: slowFunctionCall
  properties:
    functions:
      - match: ^app/models
    timeAllowed: 0.25
```

## Schema validation

The configuration YAML is validated against the rule schema before the scan is run. Any errors in
the configuration are reported, and must be fixed before the scan can continue. Consult the
documentation for each rule to see it's pattern filters and other configurable properties.

## Development

We use `yarn` for package management. Run `yarn` to install dependencies and `yarn build` to emit
JavaScript. To run without first emitting JavaScript to the filesystem, use `yarn start`.

## Installation

Install like any other Node.js package, using `yarn` or `npm`:

```bash
yarn add --dev @appland/scanner
```

Then, you may find it convenient to add some scripts to your `package.json`:

```
  "scripts": {
    "scan": "npx @appland/scanner scan --appmap-dir tmp/appmap",
    "scan-ci": "npx @appland/scanner ci --appmap-dir tmp/appmap",
  },
```

**Note** `tmp/appmap` is the standard AppMap location for some AppMap agents, but not all. Consult
your agent documentation and settings to configure the `--appmap-dir`.

## Scan locally

```bash
yarn run scan
```

Findings will be printed to the console, and saved to `appland-findings.json`.

## CI integration

When using Appmap Scanner in CI you can post findings summary as a commit status and/or a PR comment
(currently only GitHub is supported). In order to allow access to your repo you need to create a
[personal token](https://github.com/settings/tokens/new) with following privileges and add it as a
`GH_TOKEN` env variable to your CI:

- `repo` for posting PR comments
- `repo:status` for posting commit statuses

```bash
yarn run scan-ci
```

## Development

### Using a local branch of `@appland/models`

Use `yarn link` to create a symlink to a local version of `@appland/models`. Make sure the models
package is built according to the instructions in its own README.

```sh
$ yarn link ../appmap-js/packages/models
```