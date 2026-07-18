---
type: Quickstart
title: Quickstart
description: Install, configure, and run Wiki Agent to generate a wiki for any repository.
tags: [quickstart, install, setup]
---

# Quickstart

Wiki Agent is a standalone documentation agent that uses Ollama (local or cloud) to inspect a repository and produce a wiki under `.wiki/`. It exposes a small CLI plus an interactive TUI and ships a GitHub Actions workflow for scheduled updates.

## 1. Install

Install from npm:

```bash
npm install -g @nx-solutions-ug/wiki-agent
```

Or build from source and install globally with Bun:

```bash
git clone https://github.com/nx-solutions-ug/wiki-agent.git
cd wiki-agent
bun install
bun run build
bun run pack
cd ~/.bun/install/global && bun add /path/to/wiki-agent/wiki-agent-<version>.tgz
```

The `wiki` command is on `PATH` (entrypoint: `dist/cli.js`, declared as the `bin` in `package.json`).

Verify the install:

```bash
wiki --help
```

## 2. Choose an Ollama mode

Wiki Agent speaks to Ollama in one of two modes:

- **Local** — talks to a running Ollama server on `http://localhost:11434`. No API key.
- **Cloud** — talks to Ollama Cloud at `https://ollama.com`. Requires an API key.

You can configure the mode interactively by running `wiki --init` once, or non-interactively through environment variables and config files. See [Configuration](./configuration.md) for the full priority order.

## 3. Run the agent

```bash
# Initialize a wiki for the current repository
wiki --init

# Refresh an existing wiki
wiki --update

# Headless / CI mode (prints events to stdout)
wiki --update --print

# Override the model for a single run
wiki --init --print --model llama3.2
```

The first run will create `.wiki/quickstart.md` plus a small set of section pages. After every run, `index.md` files are generated for each directory under `.wiki/` (see [Architecture](./architecture/overview.md)).

## 4. Update from CI

Running `wiki --init` writes `.github/workflows/update-wiki.yml` into your repo. Set `WIKI_OLLAMA_API_KEY` as a secret to enable the scheduled job, which runs `wiki --update --print` and opens a PR with the `.wiki/` changes. See [GitHub Actions](./automation/github-actions.md).

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

After the run, `index.md` files in each subdirectory are regenerated to list the contained files using their frontmatter titles and descriptions.
