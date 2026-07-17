---
type: Reference
title: Development
description: Build, test, and release workflow for the wiki-agent package.
tags: [development, build, test, release]
---

# Development

This page covers the day-to-day commands for hacking on Wiki Agent itself, not on the wikis it produces.

## Prerequisites

- Node.js 22+ (declared in `package.json` `engines.node`).
- pnpm (the lockfile is `pnpm-lock.yaml`).
- bun — only required if you want to use `bun pm pack` and `bun run clean`. The `prebuild` script uses bun; if you do not have bun, run `tsc` directly.

## Install

```bash
pnpm install
```

## Build

```bash
pnpm run build
```

This runs the `prebuild` cleanup (`rm -rf dist`) and then `tsc -p tsconfig.json`. The compiler emits `*.js` and `*.d.ts` files into `dist/` from `src/**/*.ts(x)`. The TS config uses `module: nodenext`, `moduleResolution: nodenext`, `target: ES2022`, and `jsx: react-jsx`.

## Test

```bash
pnpm test
```

Runs `vitest run` against the test files in `test/`. There are four suites:

- `config.test.ts` — global/project config I/O and `resolveConfig` precedence.
- `tools.test.ts` — path-safety checks, file read/write/edit, and tool definition shape.
- `index-middleware.test.ts` — `index.md` regeneration, exclusions, and idempotency.
- `prompt.test.ts` — system prompt, user message templates, and help text contents.

The tests use `mkdtemp` for hermetic filesystem state and back up `process.env.HOME` so the global config path can be redirected.

## Pack

```bash
pnpm pack
```

Produces `wiki-agent-0.1.0.tgz` (the file at the repo root is from a previous pack). The tarball includes `dist/`, `README.md`, and `.github/workflows/wiki-update.yml` per the `files` field.

## Project layout

```
src/
  cli.tsx              CLI entrypoint, arg parsing, TUI vs. headless
  agent.ts             Ollama tool-calling loop
  config.ts            Global/project config, Ollama client factory
  prompt.ts            System prompt, user message, help text
  tools.ts             read_file, write_file, edit_file, ls, grep, glob, execute
  index-middleware.ts  Post-run index.md regeneration
  tui/
    App.tsx            Top-level TUI shell
    CredentialsSetup.tsx
    RunView.tsx
test/                  Vitest suites
.github/workflows/wiki-update.yml
```

See [Architecture](./architecture/overview.md) for how these pieces fit together at runtime.

## Release checklist

1. Bump `version` in `package.json`.
2. `pnpm run build && pnpm test`.
3. `pnpm pack` and inspect the tarball.
4. `npm publish` (or your registry of choice).
5. Tag the release in git so consumers can pin a version.
