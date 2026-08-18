---
type: Reference
title: Terminal UI
description: The Ink-based interactive terminal UI — credentials wizard, embedding setup, run view, and event rendering.
tags: [tui, ink, react, interactive, providers]
---

# Terminal UI

When the CLI is launched without `--print`, `cli.tsx` mounts an [Ink](https://github.com/vadimdemedes/ink) application built from three React components under `src/tui/`. The whole TUI is intentionally small: a top-level `App` chooses between the credentials setup wizard and the run view, and a single key listener handles exit.

## Top-level shell: `App.tsx`

`App` receives the parsed command, the current working directory, and a `ResolvedConfig` from `cli.tsx`. It decides which screen to render based on whether the resolved configuration is missing a credential:

- If `config.mode` is `"cloud"` or `"openai"` and no API key is set, it renders `CredentialsSetup`.
- Otherwise it renders the run view inside a rounded header box that shows the agent version, the provider mode, the model, and the project root.

A `useInput` hook listens for `q` or `Ctrl+C` at the top level and calls `useApp().exit()` to leave Ink cleanly. The same key handling is duplicated in each screen so `q` and `Ctrl+C` work everywhere.

## Credentials setup: `CredentialsSetup.tsx`

A seven-step state machine:

1. `mode-select` — the user picks `1` for Ollama Local, `2` for Ollama Cloud, or `3` for OpenAI-compatible API. The TUI does not accept Enter here; key presses drive transitions.
2. `api-key` — only reached from cloud or openai mode. Uses `ink-text-input` to read the key, validates that it is non-empty on submit.
3. `base-url` — lets the user customize the provider base URL; press Enter to keep the mode default (`http://localhost:11434`, `https://ollama.com`, or `https://api.openai.com/v1`).
4. `embedding-select` — choose the embedding backend for MCP semantic search: `1` for local Transformers.js (`all-MiniLM-L6-v2`) or `2` for Ollama embeddings.
5. `embedding-model` — only for Ollama embeddings. Defaults to `nomic-embed-text`.
6. `embedding-host` — only for Ollama embeddings. Defaults to the provider base URL.
7. `model` — defaults to `kimi-k2.7-code` and uses the same text input. The prompt text matches this default.

| Step | Key / input | Next step |
|------|-------------|-----------|
| `mode-select` | `1` / `2` / `3` | `base-url` (local) or `api-key` (cloud/openai) |
| `api-key` | Enter after non-empty key | `base-url` |
| `base-url` | Enter to keep default | `embedding-select` |
| `embedding-select` | `1` / `2` | `model` (local) or `embedding-model` (ollama) |
| `embedding-model` | Enter to keep default | `embedding-host` |
| `embedding-host` | Enter to keep default | `model` |
| `model` | Enter to keep default | `saving` |

After the final step the wizard calls `saveGlobalConfig` with the assembled `GlobalConfig` (including `baseUrl` only when it differs from the mode default, and `embeddingHost` only when it differs from the mode default), then calls the parent `onConfigSaved` callback with a synthesized `ResolvedConfig` so the run view can start without re-reading the disk.

Errors from `saveGlobalConfig` are caught and rendered in red; the wizard drops back to `mode-select` on failure.

## Run view: `RunView.tsx`

`RunView` creates the LLM client via `createLLMClient(config)` and calls `runAgent` with `stream: true` and the `wiki` flag propagated from the CLI. Each `AgentEvent` is translated into a `DisplayEvent` and appended to a ref-backed state list, which Ink re-renders.

Consecutive `assistant` chunks are merged into a single `DisplayEvent` so streaming does not fragment prose into one line per token. The mapping is:

- `assistant` — merged into one cyan paragraph prefixed with `» `. A new paragraph is started only when the previous display event was not an assistant event.
- `tool` — by default suppressed entirely. With `--verbose`, a tool event renders as a gray one-line marker with a running count (`#1 → ls`, `#2 → git`) and, below it, the result body (clamped to 1000 characters for display). Without `--verbose` the tool call is not recorded at all.
- `error` — shown in red.
- `done` — shown in green and bold; toggles the "Working…" indicator to "Done".

### `EventLine` rendering

Historical display rows are rendered by a dedicated `EventLine` component rather than inline in `RunView`. `EventLine` is wrapped in `React.memo` so that appending a new event — or merging another assistant chunk into the active row — does not re-render the unchanged rows. The active assistant row is replaced with a new immutable `DisplayEvent` object so React can bail out of the memoized rows and only re-render the row that actually changed.

While the agent is running the footer shows `⏳ Working...`; on completion it switches to `✓ Done` (or `✓ Failed: <message>`) and adds a `Press q or Ctrl+C to exit.` hint.

## Key bindings

| Key | Effect |
|-----|--------|
| `q` | Exit (from any screen) |
| `Ctrl+C` | Exit (from any screen) |
| `1` / `2` / `3` | Pick provider mode (credentials wizard only) |
| `Enter` | Submit the current text input (credentials wizard only) |

`1` / `2` also select the embedding provider during the `embedding-select` step. There are no other interactive controls. Cancellation mid-run is not implemented; the agent loop either completes or fails on its own.
