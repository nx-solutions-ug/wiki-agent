---
type: Reference
title: Development
description: Build, test, and release workflow for the wiki-agent package.
tags: [development, build, test, release]
---

# Development

This page covers the day-to-day commands for hacking on Wiki Agent itself, not on the wikis it produces.

## Prerequisites

- Node.js 22+ (declared in `package.json` `engines.node`). The CI workflows set `node-version: "25"` for the build/release jobs, while the package still supports Node.js 22 and later.
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

Runs `vitest run` against the test files in `test/`. There are seven suites:

- `config.test.ts` — global/project config I/O and `resolveConfig` precedence.
- `tools.test.ts` — path-safety checks, file read/write/edit, tool definition shape, `git` and `gh` subcommand allowlists, metacharacter guard, and `ast_grep`/`ast_search` structural matching.
- `index-middleware.test.ts` — `index.md` regeneration, exclusions, and idempotency.
- `prompt.test.ts` — system prompt, user message templates, and help text contents.
- `report.test.ts` — `generateUpdateReport`: no-op reports, created/edited listings, per-file description blockquotes, truncation, whitespace collapse, and summary counts.
- `flatten-wiki.test.ts` — filename conversion, link rewriting, frontmatter stripping, sidebar generation, and metadata exclusions.
- `version.test.ts` — `VERSION` matches `package.json` and is not a stale placeholder.

The tests use `mkdtemp` for hermetic filesystem state and back up `process.env.HOME` so the global config path can be redirected.

## Pack

```bash
bun pm pack
```

Produces `wiki-agent-1.8.1.tgz`. The tarball includes `dist/`, `README.md`, and `LICENSE` per the `files` array in `package.json`.

## Project layout

```
src/
  cli.tsx              CLI entrypoint, arg parsing, TUI vs. headless
  agent.ts             Ollama tool-calling loop, workflow/report generation
  config.ts            Global/project config, Ollama client factory
  prompt.ts            System prompt, user message, help text
  tools.ts             read_file, write_file, edit_file, ls, grep, glob, git, ast_grep, ast_search, gh
  index-middleware.ts  Post-run index.md regeneration
  flatten-wiki.ts      Convert nested .wiki/ to flat GitHub Wiki format before publish
  version.ts           Reads package.json version for CLI --version and TUI banner
  tui/
    App.tsx            Top-level TUI shell
    CredentialsSetup.tsx
    RunView.tsx
test/                  Vitest suites
assets/                Generated README banner images (FLUX 2 Max)
.github/workflows/update-wiki.yml
.github/workflows/release.yml
.github/workflows/auto-manage.yml
.github/workflows/omp.yml
.github/workflows/omp-ci.yml
```

Two binaries are produced by the build: `wiki` (`dist/cli.js`) and `wiki-flatten` (`dist/flatten-wiki.js`), both declared in `package.json` `bin`.

See [Architecture](./architecture/overview.md) for how these pieces fit together at runtime.

## Repository automation

The repo uses several GitHub Actions workflows beyond `update-wiki.yml`:

- `.github/workflows/release.yml` — runs on every push to `main`. After a passing test job it generates a GitHub App token and runs `npx --yes semantic-release` to bump `package.json`, write `CHANGELOG.md`, create a GitHub release, and publish `@chronova/wiki-agent` to npm with `secrets.NPM_TOKEN`. It then edits the release body with a full commit-level changelog built from `git log` and uploaded via `gh release edit`.
- `.github/workflows/auto-manage.yml` — tags new/reopened issues with `needs-triage` and auto-assigns new issues and PRs to `niklasschaeffer`.
- `.github/workflows/omp.yml` — invokes the OMP agent on comments containing `/omp` (or `/oc`) and routes command prompts from `.omp/commands/*.md` into OMP.
- `.github/workflows/omp-ci.yml` — automated OMP triage, PR labeling, and PR review triggered by issues/PR events.

`.releaserc.json` configures semantic-release for branches `main`, `beta`, and `alpha`, writes `CHANGELOG.md`, commits `package.json`/`CHANGELOG.md`, creates a GitHub release, and publishes via the `@semantic-release/npm` plugin. The `releaseBodyTemplate` in `.releaserc.json` also truncates the release notes at 120 000 bytes with a pointer back to `CHANGELOG.md` as a fallback. The release job additionally edits the newly created release body with a full commit-level "What's Changed" section generated locally from `git log`, replacing the default notes; if those generated notes exceed 120 000 bytes they are truncated at a safe line boundary with a pointer back to `CHANGELOG.md`. Renovate is configured with `config:recommended` in `renovate.json`. Because the project uses Bun, `package-lock.json` is not part of the git assets. The project is released under the ISC license (`LICENSE`); `package.json` sets `license: "ISC"`.

## Known source inconsistencies

- **Workflow filename mismatch**: `package.json` `files` lists `.github/workflows/wiki-update.yml`, but `src/agent.ts:createWorkflowFile` writes `.github/workflows/update-wiki.yml`. The `package.json` entry is stale because the build never ships that file; it only ships `dist/`, `README.md`, and `LICENSE`.

## Release checklist

1. `bun run build && bun run test`.
2. `bun pm pack` and inspect the tarball.
3. Push to `main`; the release workflow handles versioning, tagging, and npm publishing.
