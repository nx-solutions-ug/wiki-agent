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

Runs `vitest run` against the test files in `test/`. There are five suites:

- `config.test.ts` — global/project config I/O and `resolveConfig` precedence.
- `tools.test.ts` — path-safety checks, file read/write/edit, tool definition shape, `git` subcommand allowlist and metacharacter guard, and `ast_grep`/`ast_search` structural matching.
- `index-middleware.test.ts` — `index.md` regeneration, exclusions, and idempotency.
- `prompt.test.ts` — system prompt, user message templates, and help text contents.
- `report.test.ts` — `generateUpdateReport`: no-op reports, created/edited listings, per-file description blockquotes, truncation, whitespace collapse, and summary counts.

The tests use `mkdtemp` for hermetic filesystem state and back up `process.env.HOME` so the global config path can be redirected.

## Pack

```bash
bun pm pack
```

Produces `wiki-agent-<version>.tgz` matching the current `package.json` `version` (e.g. `1.3.0`). The tarball includes `dist/` and `README.md` only.

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

## Release pipeline

`.github/workflows/release.yml` runs on every push to `main`:

1. **Test job** — `bun install`, `bun run build`, `bun run test`.
2. **Release job** — if tests pass, generates a GitHub App token with `actions/create-github-app-token@v3` using `secrets.APP_CLIENT_ID` and `secrets.APP_PRIVATE_KEY`, runs `npx --yes semantic-release`, and publishes `@chronova/wiki-agent` to npm using the token in `secrets.NPM_TOKEN`.

`.releaserc.json` configures semantic-release for branches `main`, `beta`, and `alpha`, writes `CHANGELOG.md`, commits `package.json`/`CHANGELOG.md`, creates a GitHub release, and publishes via the `@semantic-release/npm` plugin. Because the project uses Bun, `package-lock.json` is not part of the git assets.

## Release checklist

1. `bun run build && bun run test`.
2. `bun pm pack` and inspect the tarball.
3. Push to `main`; the release workflow handles versioning, tagging, and npm publishing.
