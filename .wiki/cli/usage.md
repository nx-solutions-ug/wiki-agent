---
type: Reference
title: CLI Usage
description: Commands, flags, environment variables, and the headless / TUI
  dispatch of the wiki binary.
tags: [ cli, commands, flags, environment-variables ]
last_updated: 2026-08-27T11:22:52.400Z
updated_by: wiki-agent
---

# CLI Usage

The `wiki-agent` package installs two binaries: `wiki` (the main agent) and `wiki-flatten` (the wiki publish converter). Both are declared in `package.json` `bin` and resolve to compiled files in `dist/`.

## `wiki` — agent runner

The `wiki` command is parsed in `cli.tsx` and dispatches to either the Ink TUI or a headless runner depending on `--print`.

### Commands

Exactly one of `--init` or `--update` is required. If neither is present, the help text is printed and the process exits `0`. The `--get-config` and `--version` flags are standalone commands and do not require `--init` or `--update`.

| Command | Effect |
|---------|--------|
| `wiki --init` | Initialize wiki documentation. Drives the model with the "init" user message and writes `.github/workflows/update-wiki.yml`. |
| `wiki --update` | Refresh an existing wiki. Drives the model with the "update" user message and recent git history. Produces `.wiki/.last-update-report.md` and `.wiki/.last-updated.json` when content changes. |
| `wiki --version` | Print the current package version (read from `package.json`) and exit. |
| `wiki --get-config` | Print the merged effective configuration as JSON and exit. Useful for debugging config resolution. |
| `wiki --help` / `-h` | Print the help text and exit. |

### Flags

| Flag | Effect |
|------|--------|
| `--wiki` | Meaningful with `--init`: the generated `.github/workflows/update-wiki.yml` will also publish to the repository's GitHub Wiki tab. Note that the generated workflow itself hardcodes `--wiki` in its `wiki --update --print --verbose --wiki` step, so the CI job always attempts wiki publishing regardless of whether `--wiki` was passed locally. |
| `--print` | Run headless: write events to stdout/stderr instead of launching the TUI. Required for CI. |
| `--model <id>` | Override the model for this run. Higher priority than env vars and config files. |
| `--mcp stdio` | Start the MCP server on stdin/stdout. No `--init`/`--update` required; runs standalone. |
| `--get-config` | Print the merged effective configuration (after env vars, config files, and `--model` are applied) as JSON and exit. |
| `--verbose`, `-v` | Show tool call results in addition to assistant prose. Without this flag, tool events are suppressed in both headless and TUI output. |
| `--help`, `-h` | Show help. |

Argument parsing is permissive: unknown flags are ignored. Combine freely, e.g. `wiki --update --print --model llama3.2` or `wiki --init --wiki`.

## Environment variables

Environment variables are merged with config files by `resolveConfig` in `config.ts`. The full priority order is documented in [Configuration](../configuration.md); the variables themselves are:

| Variable | Description | Default |
|----------|-------------|---------|
| `WIKI_PROVIDER_MODE` | `"local"`, `"cloud"`, or `"openai"` | from `~/.wiki/config.json` |
| `WIKI_PROVIDER_API_KEY` | API key for cloud or openai mode | from `~/.wiki/config.json` |
| `WIKI_PROVIDER_BASE_URL` | Override the provider base URL | mode default (`http://localhost:11434` / `https://ollama.com` / `https://api.openai.com/v1`) |
| `WIKI_OLLAMA_MODE` | Legacy alias for `WIKI_PROVIDER_MODE` (still honored) | from `~/.wiki/config.json` |
| `WIKI_OLLAMA_API_KEY` | Legacy alias for `WIKI_PROVIDER_API_KEY` | from `~/.wiki/config.json` |
| `WIKI_OLLAMA_BASE_URL` | Legacy alias for `WIKI_PROVIDER_BASE_URL` | mode default |
| `WIKI_MODEL` | Override model ID | from `~/.wiki/config.json` |
| `WIKI_EMBEDDING_PROVIDER` | `"local"` (Hugging Face) or `"ollama"` | `"local"` |
| `WIKI_EMBEDDING_MODEL` | Ollama embedding model ID (when provider is `"ollama"`) | `"nomic-embed-text"` |
| `WIKI_EMBEDDING_HOST` | Ollama host for embeddings (when provider is `"ollama"`) | `http://localhost:11434` |
| `WIKI_RECURSION_LIMIT` | Max agent iterations | `200` |
| `GH_TOKEN` | GitHub token for the read-only `gh` CLI tool (used in CI for the staging PR staleness check) | from environment |

In headless mode, the model ID is selected as: `--model` flag → `.wiki/config.json` `modelOverride` → `WIKI_MODEL` → `~/.wiki/config.json` `defaultModel` → `kimi-k2.7-code`.

The provider mode, API key, and base URL resolve via `WIKI_PROVIDER_*` env vars (or the legacy `WIKI_OLLAMA_*` aliases) first, then the global config. See [Configuration](../configuration.md) for the full precedence.

## Headless event format

When `--print` is set, `cli.tsx` invokes `runAgent` with a synchronous event sink:

- `assistant` events are written to stdout wrapped in blank lines (`\n<content>\n`) so prose does not run into adjacent tool markers.
- `tool` events are written to stdout only when `--verbose` is set, as `\n[tool: <name>]\n<result>\n`. By default they are suppressed.
- `error` events write `\nError: <message>\n` to stderr.
- The final `done` event writes its summary followed by a newline.

This is the format the GitHub Actions workflow relies on.

## TUI

Without `--print`, `cli.tsx` mounts the Ink app defined in `src/tui/`. See [TUI](../tui.md) for the interactive flow, the credentials setup wizard, and the run view.

## `wiki-flatten` — publish converter

The `wiki-flatten` binary is a standalone CLI exported from `src/flatten-wiki.ts`. It converts the nested `.wiki/` directory into the flat file layout required by GitHub Wikis.

```bash
wiki-flatten <wiki-root> <output-dir>
```

Examples:

```bash
wiki-flatten ./.wiki /tmp/wiki-flat
node dist/flatten-wiki.js ./.wiki /tmp/wiki-flat
```

Conversion rules:

- `.wiki/index.md` → `Home.md`
- `.wiki/quickstart.md` → `Quickstart.md`
- `.wiki/architecture/index.md` → `Architecture.md`
- `.wiki/architecture/overview.md` → `Architecture-Overview.md`
- Internal relative markdown links are rewritten to flat wiki page names, e.g. `[Text](./cli/usage.md)` → `[Text](CLI-Usage)`.
- YAML frontmatter is stripped because GitHub Wiki renders it as literal text.
- `_Sidebar.md` is generated from page frontmatter titles.
- Metadata files (`.last-update-report.md`, `.last-updated.json`, `.last-update-title.txt`, `config.json`, `_plan.md`) are excluded.

The GitHub Actions workflow created by `wiki --init --wiki` invokes `wiki-flatten` before pushing to `<repo>.wiki.git`.

## MCP mode

`wiki --mcp stdio` starts a Model Context Protocol server instead of running an init/update cycle. Exposed tools include:

- `read_wiki_page` — read a page by relative path under `.wiki/`.
- `list_wiki_pages` — list all `.wiki/` markdown files as relative paths.
- `search_wiki` — semantic search over the wiki via the embeddings database (auto-syncs stale files first).
- `update_wiki` — trigger a `wiki --update` run in headless mode.
- `rebuild_embeddings` — fully rebuild `.wiki/wiki.db` from the current wiki content.
- `sync_embeddings` — incrementally sync embeddings so only changed pages are re-embedded.

MCP mode is dispatched in `cli.tsx` before the normal `--init`/`--update` path. It dynamically imports `src/mcp-server.ts` so that heavy native dependencies (`better-sqlite3`, `@huggingface/transformers`) are only loaded when needed.

## `--get-config` example

```bash
wiki --get-config
wiki --get-config --model llama3.2
```

Output is the resolved `ResolvedConfig` object from `src/config.ts:resolveConfig`, printed as formatted JSON to stdout. The printed object reflects the same precedence order as a normal run: env vars and legacy aliases first, then `--model`, then project/global config, then defaults.

## Exit codes

- `wiki`: `0` — normal completion (including `--help` and `--get-config`); `1` — unhandled exception in `main`, or API key missing when the resolved config is `cloud` or `openai` mode.
- `wiki-flatten`: `0` — success; `1` — missing arguments or unexpected error.
