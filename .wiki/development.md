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

Runs `vitest run` against the test files in `test/`. There are nine suites:

- `config.test.ts` — global/project config I/O and `resolveConfig` precedence.
- `tools.test.ts` — path-safety checks, file read/write/edit, tool definition shape, `git` and `gh` subcommand allowlists, metacharacter guard, and `ast_grep`/`ast_search` structural matching.
- `index-middleware.test.ts` — `index.md` regeneration, exclusions, and idempotency.
- `prompt.test.ts` — system prompt, user message templates, and help text contents.
- `report.test.ts` — `generateUpdateReport`: no-op reports, created/edited listings, per-file description blockquotes, truncation, whitespace collapse, and summary counts.
- `flatten-wiki.test.ts` — filename conversion, link rewriting, frontmatter stripping, sidebar generation, and metadata exclusions.
- `stream-log.test.ts` — `.omp/stream-log.py` JSON log parsing and safe handling of non-dict or non-string event payloads.
- `version.test.ts` — `VERSION` matches `package.json` and is not a stale placeholder.

The tests use `mkdtemp` for hermetic filesystem state and back up `process.env.HOME` so the global config path can be redirected.

## Pack

```bash
bun pm pack
```

Produces `wiki-agent-1.11.1.tgz`. The tarball includes `dist/`, `README.md`, and `LICENSE` per the `files` array in `package.json`.

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
.github/workflows/omp-fix-issue.yml
.github/workflows/vouch-manage.yml
.github/workflows/vouch-pr.yml
```

Two binaries are produced by the build: `wiki` (`dist/cli.js`) and `wiki-flatten` (`dist/flatten-wiki.js`), both declared in `package.json` `bin`.

See [Architecture](./architecture/overview.md) for how these pieces fit together at runtime.

## Repository automation

The repo uses several GitHub Actions workflows beyond `update-wiki.yml`:

- `.github/workflows/release.yml` — runs on every push to `main`. After a passing test job it generates a GitHub App token and runs `npx --yes semantic-release` to bump `package.json`, write `CHANGELOG.md`, create a GitHub release, and publish `@chronova/wiki-agent` to npm with `secrets.NPM_TOKEN`. After the release step it derives the latest tag from the local repo (avoiding API eventual-consistency races) and uses `gh release edit` to overwrite the release body with a full commit-level "What's Changed" section built from `git log --pretty=format:"- %s (%h)" --no-merges` between the previous and current tags. If those notes exceed 120 000 bytes they are truncated at the last complete line before the limit and a pointer to `CHANGELOG.md` is appended.
- `.github/workflows/auto-manage.yml` — tags new/reopened issues with `needs-triage` and auto-assigns new issues and PRs to `niklasschaeffer`.
- `.github/workflows/omp.yml` — invokes the OMP agent on comments containing `/omp` (or `/oc`) and routes command prompts from `.omp/commands/*.md` into OMP.
- `.github/workflows/omp-ci.yml` — automated OMP triage, PR labeling, and PR review triggered by issues/PR events.
- `.github/workflows/omp-fix-issue.yml` — triggered by a `repository_dispatch` `issue-triaged` event from `omp-ci.yml`; runs OMP with `.omp/commands/fix-issue.md` to attempt an automated fix for a triaged issue.
- `.github/workflows/vouch-manage.yml` — lets maintainers update `.github/VOUCHED.td` by commenting `!vouch`, `!denounce`, or `!unvouch` on a discussion. Only admin/maintain/write collaborators are honored.
- `.github/workflows/vouch-pr.yml` — auto-closes PRs from unvouched users via `pull_request_target`; bots (`[bot]` suffix) and collaborators with write access are automatically allowed. Vouched PRs are labeled `vouched`.

`.releaserc.json` configures semantic-release for branches `main`, `beta`, and `alpha`, writes `CHANGELOG.md`, commits `package.json`/`CHANGELOG.md`, creates a GitHub release, and publishes via the `@semantic-release/npm` plugin. Renovate is configured with `config:recommended` in `renovate.json`. Because the project uses Bun, `package-lock.json` is not part of the git assets. The project is released under the ISC license (`LICENSE`); `package.json` sets `license: "ISC"`.

## Contributing

The project uses a lightweight vouch system for PR gating (commit `d9f582d`). See `CONTRIBUTING.md` for the contributor-facing rules:

- Pull requests are only accepted from **vouched contributors**.
- To become vouched, open a **discussion** describing the proposed contribution; a maintainer comments `!vouch` to add the author to `.github/VOUCHED.td`.
- Bots (handles ending in `[bot]`) and collaborators with write access are automatically allowed.
- Maintainers can also `!denounce @user` to block a contributor or `!unvouch @user` to remove an existing vouch.

This is enforced by `.github/workflows/vouch-pr.yml` (the gate) and `.github/workflows/vouch-manage.yml` (maintainer commands via discussion comments).

## Known source inconsistencies

There are no currently documented source inconsistencies in the tracked files. `package.json` `files` ships only `dist/`, `README.md`, and `LICENSE`; `src/agent.ts:createWorkflowFile` writes `.github/workflows/update-wiki.yml` into target repositories at runtime.

## Release checklist

1. `bun run build && bun run test`.
2. `bun pm pack` and inspect the tarball.
3. Push to `main`; the release workflow handles versioning, tagging, and npm publishing.
