---
type: Reference
title: CLI Usage
description: Commands, flags, environment variables, and the headless / TUI dispatch of the wiki binary.
tags: [cli, commands, flags, environment-variables]
---

# CLI Usage

The `wiki-agent` package installs two binaries: `wiki` (the main agent) and `wiki-flatten` (the wiki publish converter). Both are declared in `package.json` `bin` and resolve to compiled files in `dist/`.

## `wiki` — agent runner

The `wiki` command is parsed in `cli.tsx` and dispatches to either the Ink TUI or a headless runner depending on `--print`.

### Commands

Exactly one of `--init` or `--update` is required. If neither is present, the help text is printed and the process exits `0`.

| Command | Effect |
|---------|--------|
| `wiki --init` | Initialize wiki documentation. Drives the model with the "init" user message and writes `.github/workflows/update-wiki.yml`. |
| `wiki --update` | Refresh an existing wiki. Drives the model with the "update" user message and recent git history. Produces `.wiki/.last-update-report.md` and `.wiki/.last-updated.json` when content changes. |
| `wiki --help` / `-h` | Print the help text and exit. |
| `wiki --version` | Print the installed version (`wiki-agent v<version>`) and exit. |

### Flags

| Flag | Effect |
|------|--------|
| `--wiki` | Meaningful with `--init`: the generated `.github/workflows/update-wiki.yml` will also publish to the repository's GitHub Wiki tab. Ignored by the CLI in other combinations; the workflow handles publishing. |
| `--print` | Run headless: write events to stdout/stderr instead of launching the TUI. Required for CI. |
| `--model <id>` | Override the model for this run. Higher priority than env vars and config files. |
| `--verbose`, `-v` | Show tool call results in addition to assistant prose. Without this flag, tool events are suppressed in both headless and TUI output. |
| `--help`, `-h` | Show help. |
| `--version` | Show the installed version (`wiki-agent v<version>`) and exit. The version is read dynamically from `package.json` via `src/version.ts`. |

Argument parsing is permissive: unknown flags are ignored. Combine freely, e.g. `wiki --update --print --model llama3.2` or `wiki --init --wiki`.

## Environment variables

Environment variables are merged with config files by `resolveConfig` in `config.ts`. The full priority order is documented in [Configuration](../configuration.md); the variables themselves are:

| Variable | Description | Default |
|----------|-------------|---------|
| `WIKI_OLLAMA_MODE` | `"local"` or `"cloud"` | from `~/.wiki/config.json` |
| `WIKI_OLLAMA_API_KEY` | API key for cloud mode | from `~/.wiki/config.json` |
| `WIKI_OLLAMA_BASE_URL` | Override the Ollama server URL | `http://localhost:11434` (local) or `https://ollama.com` (cloud) |
| `WIKI_MODEL` | Override model ID | from `~/.wiki/config.json` |
| `WIKI_RECURSION_LIMIT` | Max agent iterations | `200` |
| `GH_TOKEN` | GitHub token for the read-only `gh` CLI tool (used in CI for the staging PR staleness check) | from environment |

In headless mode, the model ID is selected as: `--model` flag → `projectConfig.modelOverride` → `WIKI_MODEL` → `globalConfig.defaultModel` → `kimi-k2.7-code`.

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
- Metadata files (`.last-update-report.md`, `.last-updated.json`, `config.json`, `_plan.md`) are excluded.

The GitHub Actions workflow created by `wiki --init --wiki` invokes `wiki-flatten` before pushing to `<repo>.wiki.git`.

## Exit codes

- `wiki`: `0` — normal completion (including `--help` and `--version`); `1` — unhandled exception in `main`, or `WIKI_OLLAMA_API_KEY` missing when `config.mode === "cloud"`.
- `wiki-flatten`: `0` — success; `1` — missing arguments or unexpected error.
