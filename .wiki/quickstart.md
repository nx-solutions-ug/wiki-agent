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
bun add -g @chronova/wiki-agent
```

Or build from source and install globally with bun:

```bash
git clone https://github.com/nx-solutions-ug/wiki-agent.git
cd wiki-agent
bun install
bun run build
bun pm pack
cd ~/.bun/install/global && bun add /path/to/wiki-agent/wiki-agent-1.9.0.tgz
```

After install, the `wiki` command is on `PATH` (entrypoint: `dist/cli.js`, declared as the `bin` in `package.json`).

Verify the install:

```bash
wiki --version
wiki --help
```

The project assets include a generated banner image at `assets/banner-flux.png` used by the README.

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

# Show the installed version
wiki --version

# Override the model for a single run
wiki --init --print --model llama3.2
```

The first run will create `.wiki/quickstart.md` plus a small set of section pages. After every run, `index.md` files are generated for each directory under `.wiki/` (see [Architecture](./architecture/overview.md)).

## 4. Update from CI

Running `wiki --init` writes `.github/workflows/update-wiki.yml` into your repo. Set `WIKI_OLLAMA_API_KEY` as a secret to enable the scheduled job. By default the generated workflow runs `wiki --update --print --verbose --wiki` and pushes the flattened pages directly to the repository's **GitHub Wiki tab**; it also opens a staging pull request with the `.wiki/` changes in the main repo. If you do not want the workflow to publish to the wiki tab, run `wiki --init` without `--wiki` (the CLI ignores `--wiki` on `--update`). See [GitHub Actions](./automation/github-actions.md).

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
