---
type: Quickstart
title: Quickstart
description: Install, configure, and run Wiki Agent to generate a wiki for any repository.
tags: [ quickstart, install, setup ]
last_updated: 2026-08-30T17:07:25.538Z
updated_by: wiki-agent
---

# Quickstart

Wiki Agent is a standalone documentation agent that runs against Ollama (local or cloud) or any OpenAI-compatible provider. It inspects a repository and produces a wiki under `.wiki/`, with an optional interactive TUI and a headless `--print` mode for CI.

## 1. Install

Install from npm:

```bash
bun add -g @chronova/wiki-agent
```

Or build from source and install globally with bun:

```bash
git clone https://github.com/nx-solutions-ug/wiki-agent.git
cd wiki-agent
bun install
bun run build
bun pm pack
cd ~/.bun/install/global && bun add /path/to/wiki-agent/wiki-agent-1.19.0.tgz
```

After install, the `wiki` command is on `PATH` (entrypoint: `dist/cli.js`, declared as the `bin` in `package.json`).

Verify the install:

```bash
wiki --version
wiki --help
wiki --get-config
```

The README uses a hero banner at `public/banner.png`. The npm tarball only includes `dist/`, `README.md`, and `LICENSE` (the `files` array in `package.json`); workflows are generated into target repos by `--init`, not shipped in the package.

## 2. Configure the provider

Wiki Agent supports three provider modes:

- **Local** — talks to a running Ollama server on `http://localhost:11434`. No API key.
- **Cloud** — talks to Ollama Cloud at `https://ollama.com`. Requires an API key.
- **OpenAI-compatible** — talks to any OpenAI-compatible endpoint (OpenRouter, Azure OpenAI, vLLM, LM Studio, Ollama's OpenAI-compatible mode, etc.) at a configurable base URL. Requires an API key.

Run `wiki --init` once to configure the mode and API key interactively, or set environment variables and config files. On `--init`, the agent also appends a `## Wiki Agent` section to `AGENTS.md` (or `CLAUDE.md` if only that exists) declaring that the project is managed by wiki-agent, with the current version and initialization timestamp. If neither file exists, it creates `AGENTS.md`. See [Configuration](./configuration.md) for precedence.

## 3. Run the agent

```bash
# Initialize a wiki for the current repository
wiki --init

# Refresh an existing wiki
wiki --update

# Headless / CI mode (prints events to stdout)
wiki --update --print

# Show the installed version
wiki --version

# Print the merged configuration for debugging
wiki --get-config

# Override the model for a single run
wiki --init --print --model llama3.2
```

The first run will create `.wiki/quickstart.md` plus a small set of section pages. After every run, `index.md` files are generated for each directory under `.wiki/` (see [Architecture](./architecture/overview.md)).

## 4. Update from CI

Running `wiki --init` writes `.github/workflows/update-wiki.yml` into your repo. Set `WIKI_PROVIDER_API_KEY` (or the legacy `WIKI_OLLAMA_API_KEY`) as a secret to enable the scheduled job for cloud/openai mode. By default the generated workflow runs `wiki --update --print --verbose --wiki` and pushes the flattened pages directly to the repository's **GitHub Wiki tab**; it also opens a staging pull request with the `.wiki/` changes in the main repo. Note that the workflow itself hardcodes `--wiki`, so the CI job always attempts wiki publishing; the local `--wiki` flag only controls what is written into the workflow template. See [GitHub Actions](./automation/github-actions.md).

## What gets generated

Wiki Agent writes only inside `.wiki/`. Each page starts with YAML frontmatter (`type`, `title`, `description`, `tags`) and the layout is opinionated:

- `.wiki/quickstart.md` — this page (or a project-specific equivalent)
- `.wiki/architecture/` — system-level overview for humans and agents
- `.wiki/cli/` — command, options, environment variables
- `.wiki/configuration.md` — config file layout and resolution
- `.wiki/tools.md` — the file and discovery tools the agent uses
- `.wiki/tui.md` — interactive terminal UI
- `.wiki/automation/` — CI integrations
- `.wiki/development.md` — build, test, and release

After the run, `index.md` files in each subdirectory are regenerated to list the contained files using their frontmatter titles and descriptions. A local `.wiki/wiki.db` and run-metadata files (`.last-updated.json`, `.last-update-report.md`, `.last-update-title.txt`) are also gitignored.
