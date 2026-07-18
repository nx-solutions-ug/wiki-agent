---
type: Reference
title: CLI Usage
description: Commands, flags, environment variables, and the headless / TUI dispatch of the wiki binary.
tags: [cli, commands, flags, environment-variables]
---

# CLI Usage

The `wiki` command is installed by the `wiki-agent` package and resolves to `dist/cli.js`. It is parsed in `cli.tsx` and dispatches to either the Ink TUI or a headless runner depending on `--print`.

## Commands

Exactly one of `--init` or `--update` is required. If neither is present, the help text is printed and the process exits `0`.

| Command | Effect |
|---------|--------|
| `wiki --init` | Initialize wiki documentation. Drives the model with the "init" user message. |
| `wiki --update` | Refresh an existing wiki. Drives the model with the "update" user message and recent git history. |
| `wiki --help` / `-h` | Print the help text and exit. |

## Flags

| Flag | Effect |
|------|--------|
| `--print` | Run headless: write events to stdout/stderr instead of launching the TUI. Required for CI. |
| `--verbose`, `-v` | Show full tool-call logs (tool markers and result bodies). Default output is assistant prose only. |
| `--model <id>` | Override the model for this run. Higher priority than env vars and config files. |
| `--help`, `-h` | Show help. |

Argument parsing is permissive: unknown flags are ignored. Combine freely, e.g. `wiki --update --print --model llama3.2`.

## Environment variables

Environment variables are merged with config files by `resolveConfig` in `config.ts`. The full priority order is documented in [Configuration](../configuration.md); the variables themselves are:

| Variable | Description | Default |
|----------|-------------|---------|
| `WIKI_OLLAMA_MODE` | `"local"` or `"cloud"` | from `~/.wiki/config.json` |
| `WIKI_OLLAMA_API_KEY` | API key for cloud mode | from `~/.wiki/config.json` |
| `WIKI_OLLAMA_BASE_URL` | Override the Ollama server URL | `http://localhost:11434` (local) or `https://ollama.com` (cloud) |
| `WIKI_MODEL` | Override model ID | from `~/.wiki/config.json` |
| `WIKI_RECURSION_LIMIT` | Max agent iterations | `200` |

In headless mode, the model ID is selected as: `--model` flag → `projectConfig.modelOverride` → `WIKI_MODEL` → `globalConfig.defaultModel` → `kimi-k2.7-code`.

## Headless event format

When `--print` is set, `cli.tsx` invokes `runAgent` with a synchronous event sink:

- `assistant` events are concatenated to stdout as they arrive.
- `tool` events write `\n[tool: <name>]\n<result>\n` to stdout, but only when `--verbose` is set. Without `--verbose`, the headless output is assistant prose only.
- `error` events write `\nError: <message>\n` to stderr.
- The final `done` event writes its summary followed by a newline.

The bundled GitHub Actions workflow passes `--verbose` so CI logs contain the full agent trace. Use the default when you want only the readable prose stream.

## TUI

Without `--print`, `cli.tsx` mounts the Ink app defined in `src/tui/`. See [TUI](../tui.md) for the interactive flow, the credentials setup wizard, and the run view.

## Exit codes

- `0` — normal completion (including `--help`).
- `1` — unhandled exception in `main`, or `WIKI_OLLAMA_API_KEY` missing when `config.mode === "cloud"`.
