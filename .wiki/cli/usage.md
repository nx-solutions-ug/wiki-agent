---
type: Reference
title: CLI Usage
description: Commands, flags, environment variables, MCP server, and the headless / TUI dispatch of the wiki binary.
tags: [cli, commands, flags, environment-variables]
---

# CLI Usage

The `wiki-agent` package installs two binaries: `wiki` (the main agent) and `wiki-flatten` (the wiki publish converter). Both are declared in `package.json` `bin` and resolve to compiled files in `dist/`.

## `wiki` — agent runner

The `wiki` command is parsed in `cli.tsx` and dispatches to either the Ink TUI, a headless runner (`--print`), or the MCP server (`--mcp stdio`) depending on the flags.

### Commands

Exactly one of `--init`, `--update`, or `--mcp stdio` is required. If none is present, the help text is printed and the process exits `0`.

| Command | Effect |
|---------|--------|
| `wiki --init` | Initialize wiki documentation. Drives the model with the "init" user message and writes `.github/workflows/update-wiki.yml`. |
| `wiki --update` | Refresh an existing wiki. Drives the model with the "update" user message and recent git history. Produces `.wiki/.last-update-report.md` and `.wiki/.last-updated.json` when content changes. |
| `wiki --mcp stdio` | Start the streamable MCP server exposing wiki read/search/update/rebuild tools to MCP clients. |
| `wiki --version` | Print the current package version (read from `package.json`) and exit. |
| `wiki --help` / `-h` | Print the help text and exit. |

### Flags

| Flag | Effect |
|------|--------|
| `--wiki` | Meaningful with `--init`: the generated `.github/workflows/update-wiki.yml` will also publish to the repository's GitHub Wiki tab. Note that the generated workflow itself hardcodes `--wiki` in its `wiki --update --print --verbose --wiki` step, so the CI job always attempts wiki publishing regardless of whether `--wiki` was passed locally. |
| `--print` | Run headless: write events to stdout/stderr instead of launching the TUI. Required for CI. |
| `--model <id>` | Override the model for this run. Higher priority than env vars and config files. |
| `--verbose`, `-v` | Show tool call results in addition to assistant prose. Without this flag, tool events are suppressed in both headless and TUI output. |
| `--mcp <transport>` | Start the MCP server. Currently only `stdio` is supported. |
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
| `WIKI_RECURSION_LIMIT` | Max agent iterations | `200` |
| `WIKI_EMBEDDING_PROVIDER` | Embedding backend for semantic search: `"local"` or `"ollama"` | `local` |
| `WIKI_EMBEDDING_MODEL` | Ollama embedding model (only used when provider is `ollama`) | `nomic-embed-text` |
| `WIKI_EMBEDDING_HOST` | Ollama server URL for embeddings | `http://localhost:11434` |
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

## `wiki --mcp stdio` — MCP server

Starts a streamable [Model Context Protocol](https://modelcontextprotocol.io) server that exposes wiki-agent functionality to MCP clients such as Claude Desktop or Cursor. The server is lazily loaded: `--mcp stdio` dynamically imports `src/mcp-server.ts`, so the heavy native dependencies (`better-sqlite3`, `sqlite-vec`, `@huggingface/transformers`) are only loaded when MCP mode is used.

Tools exposed over stdio:

| Tool | Purpose |
|------|---------|
| `read_wiki_page` | Read a wiki page by relative path under `.wiki/` (`.md` extension is optional). |
| `list_wiki_pages` | List all markdown pages under `.wiki/` as relative paths. |
| `search_wiki` | Semantic search over wiki content using the embeddings database. Auto-syncs stale files before searching. |
| `update_wiki` | Trigger a wiki-agent update run (equivalent to `wiki --update --print`). |
| `rebuild_embeddings` | Delete and rebuild the `.wiki/wiki.db` vector index from all wiki pages. |
| `sync_embeddings` | Incrementally re-embed only added, modified, or removed pages. |

Example configuration for Claude Desktop:

```json
{
  "mcpServers": {
    "wiki-agent": {
      "command": "wiki",
      "args": ["--mcp", "stdio"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

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
- Metadata files (`.last-update-report.md`, `.last-updated.json`, `.last-update-title.txt`, `config.json`, `_plan.md`) and the SQLite database (`wiki.db`, `wiki.db-journal`, `wiki.db-wal`, `wiki.db-shm`) are excluded.

The GitHub Actions workflow created by `wiki --init --wiki` invokes `wiki-flatten` before pushing to `<repo>.wiki.git`.

## Exit codes

- `wiki`: `0` — normal completion (including `--help` and `--mcp stdio`); `1` — unhandled exception in `main`, or API key missing when the resolved config is `cloud` or `openai` mode.
- `wiki-flatten`: `0` — success; `1` — missing arguments or unexpected error.
