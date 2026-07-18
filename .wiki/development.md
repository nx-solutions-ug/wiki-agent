---
type: Reference
title: Development
description: Build, test, and release workflow for the wiki-agent package.
tags: [development, build, test, release]
---

# Development

This page covers the day-to-day commands for hacking on Wiki Agent itself, not on the wikis it produces.

## Prerequisites

- Node.js 22+ (declared in `package.json` `engines.node`). Node runs the compiled CLI.
- Bun — used as the package manager and packer. The `prebuild` script uses `bun run clean` and `bun pm pack` produces the tarball. If you do not have bun, run `tsc` directly and use `npm pack`.

## Install

```bash
bun install
```

## Build

```bash
bun run build
```

This runs the `prebuild` cleanup (`rm -rf dist`) and then `tsc -p tsconfig.json`. The compiler emits `*.js` and `*.d.ts` files into `dist/` from `src/**/*.ts(x)`. The TS config uses `module: nodenext`, `moduleResolution: nodenext`, `target: ES2022`, and `jsx: react-jsx`.

## Test

```bash
bun run test
```

Runs `vitest run` against the test files in `test/`. There are four suites:

- `config.test.ts` — global/project config I/O and `resolveConfig` precedence.
- `tools.test.ts` — path-safety checks, file read/write/edit, tool definition shape, `git` subcommand allowlist and metacharacter guard, and `ast_grep`/`ast_search` structural matching.
- `index-middleware.test.ts` — `index.md` regeneration, exclusions, and idempotency.
- `prompt.test.ts` — system prompt, user message templates, and help text contents.

The tests use `mkdtemp` for hermetic filesystem state and back up `process.env.HOME` so the global config path can be redirected.

## Pack

```bash
bun run pack
```

Produces `wiki-agent-<version>.tgz`. The `files` field ships `dist/` and `README.md`. The tarball does not include workflows; the `update-wiki.yml` workflow is written into target repositories by `wiki --init`.

## Project layout

```
src/
  cli.tsx              CLI entrypoint, arg parsing, TUI vs. headless
  agent.ts             Ollama tool-calling loop, workflow/report generation
  config.ts            Global/project config, Ollama client factory
  prompt.ts            System prompt, user message, help text
  tools.ts             read_file, write_file, edit_file, ls, grep, glob, git, ast_grep, ast_search
  index-middleware.ts  Post-run index.md regeneration
  tui/
    App.tsx            Top-level TUI shell
    CredentialsSetup.tsx
    RunView.tsx
test/                  Vitest suites
.github/workflows/update-wiki.yml
```

See [Architecture](./architecture/overview.md) for how these pieces fit together at runtime.

## Release

Releases are automated with [semantic-release](https://semantic-release.gitbook.io/semantic-release/) via `.github/workflows/release.yml` on every push to `main`.

The workflow runs `bun run build` and `bun run test` first; if both pass, it invokes `npx semantic-release`. `semantic-release` analyzes conventional commits, updates `package.json` and `CHANGELOG.md`, publishes the package to npm, and creates a GitHub release. The `.releaserc.json` config also produces `alpha` and `beta` pre-releases from matching branches.

Required secrets for the release job:

- `NPM_TOKEN` — npm publish token.
- `APP_CLIENT_ID` and `APP_PRIVATE_KEY` — GitHub App credentials for generating a release token (fallback to `GITHUB_TOKEN`).
