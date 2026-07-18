---
type: Reference
title: Terminal UI
description: The Ink-based interactive terminal UI — credentials wizard, run view, and event rendering.
tags: [tui, ink, react, interactive]
---

# Terminal UI

When the CLI is launched without `--print`, `cli.tsx` mounts an [Ink](https://github.com/vadimdemedes/ink) application built from three React components under `src/tui/`. The whole TUI is intentionally small: a top-level `App` chooses between the credentials setup wizard and the run view, and a single key listener handles exit.

## Top-level shell: `App.tsx`

`App` receives the parsed command, the current working directory, and a `ResolvedConfig` from `cli.tsx`. It decides which screen to render based on whether the resolved configuration is missing a credential:

- If `config.mode === "cloud"` and no API key is set, it renders `CredentialsSetup`.
- Otherwise it renders the run view inside a rounded header box that shows the agent version, the Ollama mode, the model, and the project root.

A `useInput` hook listens for `q` or `Ctrl+C` at the top level and calls `useApp().exit()` to leave Ink cleanly. `q` and `Ctrl+C` work the same way in every screen.

## Credentials setup: `CredentialsSetup.tsx`

A four-step state machine:

1. `mode-select` — the user picks `1` for Ollama Local or `2` for Ollama Cloud. The TUI does not accept Enter here; key presses drive transitions.
2. `api-key` — only reached from cloud mode. Uses `ink-text-input` to read the key, validates that it is non-empty on submit.
3. `model` — defaults to `kimi-k2.7-code` and uses the same text input.
4. `saving` — calls `saveGlobalConfig` with the assembled `GlobalConfig`, then calls the parent `onConfigSaved` callback with a synthesized `ResolvedConfig` so the run view can start without re-reading the disk.

Errors from `saveGlobalConfig` are caught and rendered in red; the wizard drops back to `mode-select` on failure.

> Note: `CredentialsSetup.tsx` still renders the placeholder text "Press Enter to use the default (qwen3-coder)", but the actual initial model state and `DEFAULT_MODEL` are `kimi-k2.7-code`.

## Run view: `RunView.tsx`

`RunView` creates the Ollama client via `createOllamaClient(config)` and calls `runAgent` with `stream: true`. Each `AgentEvent` is translated into a `DisplayEvent` and appended to a ref-backed state list, which Ink re-renders.

Consecutive `assistant` chunks are merged into a single `DisplayEvent` so streaming does not fragment prose into one line per token. The mapping is:

- `assistant` — merged into one cyan paragraph prefixed with `» `. A new paragraph is started only when the previous display event was not an assistant event.
- `tool` — by default suppressed entirely. With `--verbose`, a tool event renders as a gray one-line marker with a running count (`#1 → ls`, `#2 → git`) and, below it, the result body (clamped to 1000 characters for display). Without `--verbose` the tool call is not recorded at all.
- `error` — shown in red.
- `done` — shown in green and bold; toggles the "Working…" indicator to "Done".

While the agent is running the footer shows `⏳ Working...`; on completion it switches to `✓ Done` (or `✓ Failed: <message>`) and adds a `Press q or Ctrl+C to exit.` hint.

## Key bindings

| Key | Effect |
|-----|--------|
| `q` | Exit (from any screen) |
| `Ctrl+C` | Exit (from any screen) |
| `1` / `2` | Pick Ollama mode (credentials wizard only) |
| `Enter` | Submit the current text input (credentials wizard only) |

There are no other interactive controls. Cancellation mid-run is not implemented; the agent loop either completes or fails on its own.
