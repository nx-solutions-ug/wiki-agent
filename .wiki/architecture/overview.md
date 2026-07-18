---
type: Architecture
title: Architecture Overview
description: How Wiki Agent is organized — the agent loop, tools, TUI, and post-run index synchronization.
tags: [architecture, agent, ollama]
---

# Architecture Overview

Wiki Agent is a small, single-purpose Node.js application. The runtime model is "an LLM with a constrained tool belt that writes markdown into `.wiki/`." There is no LangChain, no vector store, no long-lived memory — just a manual tool-calling loop against the Ollama chat API.

## Top-level layout

The compiled entrypoint is `dist/cli.js` (declared as the `wiki` binary in `package.json`). Source lives under `src/`:

- `cli.tsx` — argument parsing, TUI vs. headless dispatch
- `agent.ts` — the agent loop, Ollama tool calling, event stream
- `config.ts` — global/project config, Ollama client construction
- `prompt.ts` — system prompt, user message templates, help text
- `tools.ts` — file and discovery tools exposed to the model
- `index-middleware.ts` — post-run regeneration of `index.md`
- `tui/` — Ink-based terminal UI (`App`, `CredentialsSetup`, `RunView`)

See [Configuration](../configuration.md) for the data model and [Tools](../tools.md) for the agent's toolbelt.

## The agent loop

`runAgent` in `agent.ts` implements the entire control flow:

1. Build the system prompt (`createSystemPrompt`) and the user message (`createUserMessage`) for the chosen command — `init` or `update`.
2. Construct the Ollama `chat` request with the current `messages` array and the tool definitions.
3. Stream or batch the response. Collect `content` and any `tool_calls` returned by the model.
4. Normalize tool call arguments. Ollama models return arguments as either an object or a JSON string depending on the backend; `normalizeToolCallArgs` handles both and falls back to `{}` on malformed JSON.
5. Append the assistant message to the history. If there are tool calls, append a `tool` message per call (Ollama associates the result with `tool_name`, not a `tool_call_id`).
6. Loop up to `WIKI_RECURSION_LIMIT` iterations (default `200`). A response with no tool calls ends the loop.
7. After the loop, call `synchronizeWikiIndexes(.wiki)` and emit a `done` event.

Errors from the Ollama SDK are surfaced through the `error` event stream. If the model had already produced content, the loop exits with a `done` summary that includes the error message; otherwise it emits `error` and stops.

## Streaming and headless

`runAgent` accepts a `stream` option:

- TUI sets `stream: true` and the `RunView` component renders events incrementally. Consecutive assistant chunks are merged into one paragraph; tool calls are suppressed by default and shown only as one-line markers when `--verbose` is set.
- Headless mode (`--print`) sets `stream: false` and writes assistant content (wrapped in blank lines), tool results (only with `--verbose`), and the final summary to stdout/stderr.

The event shape is fixed (`AgentEvent` in `agent.ts`):

```ts
type AgentEvent =
  | { type: "assistant"; content: string }
  | { type: "tool"; name: string; result: string }
  | { type: "error"; message: string }
  | { type: "done"; summary: string };
```

## Tool sandboxing

All write operations are constrained to `.wiki/`. `resolveWikiPath` in `tools.ts` rejects any path whose absolute resolution escapes the `.wiki/` directory. Read-only tools (`read_file`, `ls`, `grep`, `glob`, `git`, `ast_grep`, `ast_search`) are constrained to the project root. The `git` tool is further limited to a read-only subcommand allowlist and rejects shell metacharacters; there is no general shell tool.

Tool results are truncated at `MAX_TOOL_RESULT_LENGTH` (10 000 characters) before being returned to the model; `read_file` additionally slices by line offset and limit.

## TUI flow

`cli.tsx` chooses between two runtimes after parsing args and resolving config:

- If `config.mode === "cloud"` and no API key is present, `App` renders `CredentialsSetup` first. The user selects local vs. cloud, enters the API key (cloud only), and a model ID. The result is persisted to `~/.wiki/config.json` and re-resolved.
- Once configured, `App` renders a header and the `RunView` component, which wires the agent's `onEvent` callback to a stateful list of display events. `q` or `Ctrl+C` exits the Ink app at any time.

## Post-run: index synchronization

`index-middleware.ts` walks the `.wiki/` tree and writes an `index.md` for every directory. For each subdirectory it recurses; for each `*.md` file it parses the YAML frontmatter, extracts `title` and `description`, and emits a sorted bulleted list grouped into "Files" and "Directories". `index.md` and `_plan.md` are excluded from listings. If a generated index matches the existing one byte-for-byte, the file is not rewritten.

This step is invoked once at the end of `runAgent` — it does not run on every tool call.

## Build and test

`tsconfig.json` targets `ES2022` with `nodenext` modules and `react-jsx`. `bun run build` cleans `dist/` and runs `tsc`; `bun run test` runs `vitest` over the test suite in `test/`. `bun pm pack` produces the npm tarball. See [Development](../development.md).
