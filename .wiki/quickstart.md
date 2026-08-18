---
type: Quickstart
title: Quickstart
description: Install, configure, and run Wiki Agent to generate a wiki for any repository.
tags: [quickstart, install, setup]
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
cd ~/.bun/install/global && bun add /path/to/wiki-agent/wiki-agent-1.16.0.tgz
```

After install, the `wiki` command is on `PATH` (entrypoint: `dist/cli.js`, declared as the `bin` in `package.json`).

Verify the install:

```bash
wiki --version
wiki --help
```

The README uses a hero banner at `public/banner.png`. The npm tarball only includes `dist/`, `README.md`, and `LICENSE` (the `files` array in `package.json`); workflows are generated into target repos by `--init`, not shipped in the package.

## 2. Configure the provider

Wiki Agent supports three provider modes:

- **Local** — talks to a running Ollama server on `http://localhost:11434`. No API key.
- **Cloud** — talks to Ollama Cloud at `https://ollama.com`. Requires an API key.
- **OpenAI-compatible** — talks to any OpenAI-compatible endpoint (OpenRouter, Azure OpenAI, vLLM, LM Studio, Ollama's OpenAI-compatible mode, etc.) at a configurable base URL. Requires an API key.

Run `wiki --init` once to configure the mode, API key, and embedding backend interactively, or set environment variables and config files. On `--init`, the agent also appends a `## Wiki Agent` section to `AGENTS.md` (or `CLAUDE.md` if only that exists) declaring that the project is managed by wiki-agent, with the current version and initialization timestamp. If neither file exists, it creates `AGENTS.md`. See [Configuration](./configuration.md) for precedence.

## 3. Run the agent

```bash
# Initialize a wiki for the current repository
wiki --init

# Refresh an existing wiki
wiki --update

# Headless / CI mode (prints events to stdout)
wiki --update --print

# Start the MCP server for AI assistants
wiki --mcp stdio

# Show the installed version
wiki --version

# Override the model for a single run
wiki --init --print --model llama3.2
```

The first run will create `.wiki/quickstart.md` plus a small set of section pages. After every run, `index.md` files are generated for each directory under `.wiki/` (see [Architecture](./architecture/overview.md)).

### MCP server (optional)

`wiki --mcp stdio` starts a streamable MCP server that exposes the wiki to compatible clients (Claude Desktop, Cursor, etc.):

- `read_wiki_page` — read a page by relative path
- `list_wiki_pages` — list all wiki pages
- `search_wiki` — semantic search with auto-sync (requires an embeddings index; build it with `rebuild_embeddings` first)
- `update_wiki` — trigger a `wiki --update --print` run
- `rebuild_embeddings` — rebuild the `.wiki/wiki.db` vector store from all pages
- `sync_embeddings` — incremental sync of changed pages

Configure the embedding provider (local Transformers.js or Ollama) in the TUI setup wizard, via the `WIKI_EMBEDDING_*` environment variables, or in `~/.wiki/config.json`.

## 4. Update from CI

Running `wiki --init` writes `.github/workflows/update-wiki.yml` into your repo. Set `WIKI_PROVIDER_API_KEY` (or the legacy `WIKI_OLLAMA_API_KEY`) as a secret to enable the scheduled job for cloud/openai mode. By default the generated workflow runs `wiki --update --print --verbose --wiki` and pushes the flattened pages directly to the repository's **GitHub Wiki tab**; it also opens a staging pull request with the `.wiki/` changes in the main repo. Note that the workflow itself hardcodes `--wiki`, so the CI job always attempts wiki publishing; the local `--wiki` flag only controls what is written into the workflow template. See [GitHub Actions](./automation/github-actions.md).

## What gets generated

Wiki Agent writes only inside `.wiki/`. Each page starts with YAML frontmatter (`type`, `title`, `description`, `tags`) and the layout is opinionated:

- `.wiki/quickstart.md` — this page (or a project-specific equivalent)
- `.wiki/architecture/` — system-level overview for humans and agents
- `.wiki/cli/` — command, options, environment variables, MCP server
- `.wiki/configuration.md` — config file layout and resolution
- `.wiki/tools.md` — the file and discovery tools the agent uses
- `.wiki/tui.md` — interactive terminal UI
- `.wiki/automation/` — CI integrations
- `.wiki/development.md` — build, test, and release

Run metadata (`.last-update-report.md`, `.last-update-title.txt`, `.last-updated.json`) and the embeddings database (`wiki.db` and its WAL/journal sidecars) are gitignored so they are never committed. The TUI setup wizard writes these settings to `~/.wiki/config.json`, which also persists the chosen embedding provider, model, and host. After the run, `index.md` files in each subdirectory are regenerated to list the contained files using their frontmatter titles and descriptions.
