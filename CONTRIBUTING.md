# Contributing

Thanks for your interest in contributing to `component-auth`. This repo is three independent
packages — `service/` (the API), `sdk/` (the headless client), and `react/` (the optional UI) — each
with its own `package.json`, built and tested on its own. There is no root build.

For the full agent/developer guide (guardrails, code style, Definition of Done), see
[`AGENTS.md`](AGENTS.md); for architecture and docs, start at [`docs/README.md`](docs/README.md).

## Prerequisites

- Node.js 20

## Build

Build each package you change from its own directory:

```bash
cd service && npm ci && npm run build     # the API
cd sdk     && npm install && npm run build # the headless client
cd react   && npm install && npm run build # the optional React UI
```

## Test

Run each package's test suite from its directory (CI runs these in `.github/workflows/dod.yml`):

```bash
cd service && npm test -- --run
cd react   && npm test -- --run
```

A change is done when the affected packages build and test green, and any docs describing changed
behaviour are updated in the same change.
