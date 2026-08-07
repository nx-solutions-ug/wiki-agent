---
type: Architecture
title: Architecture Overview
description: How Wiki Agent is organized — the agent loop, tools, TUI, and post-run index synchronization.
tags: [architecture, agent, ollama, openai]
---

# Architecture Overview

Wiki Agent is a small, single-purpose Node.js application. The runtime model is "an LLM with a constrained tool belt that writes markdown into `.wiki/`." There is no LangChain, no vector store, no long-lived memory — just a manual tool-calling loop against an LLM chat API. The agent supports Ollama (local or cloud) and OpenAI-compatible providers via a thin adapter layer in `src/llm.ts`.

## Top-level layout

The compiled entrypoint is `dist/cli.js` (declared as the `wiki` binary in `package.json`). Source lives under `src/`:

- `cli.tsx` — argument parsing, TUI vs. headless dispatch
- `agent.ts` — the agent loop, LLM tool calling, event stream
- `config.ts` — global/project config, LLM client construction
- `llm.ts` — provider-agnostic `LLMClient` interface plus `OllamaAdapter` and `OpenAIAdapter`
- `prompt.ts` — system prompt, user message templates, help text; reads `AGENTS.md`/`CLAUDE.md` with `Promise.allSettled`
- `tools.ts` — file and discovery tools exposed to the model
- `index-middleware.ts` — post-run regeneration of `index.md`
- `flatten-wiki.ts` — converts nested `.wiki/` to flat GitHub Wiki format before publish
- `tui/` — Ink-based terminal UI (`App`, `CredentialsSetup`, `RunView`)

See [Configuration](../configuration.md) for the data model, [Tools](../tools.md) for the agent's toolbelt, and [CLI Usage](../cli/usage.md) for how the `--wiki` and `--print` flags reach the loop.

## The agent loop

`runAgent` in `agent.ts` implements the entire control flow:

1. Build the system prompt (`createSystemPrompt`) and the user message (`createUserMessage`) for the chosen command — `init` or `update`.
2. Construct the LLM `chat` request with the current `messages` array and the tool definitions through the `LLMClient` adapter.
3. Stream or batch the response. Collect `content` and any `tool_calls` returned by the model.
4. Normalize tool call arguments. Ollama models return arguments as either an object or a JSON string depending on the backend; `normalizeToolCallArgs` handles both and falls back to `{}` on malformed JSON.
5. Append the assistant message to the history. If there are tool calls, append a `tool` message per call (Ollama associates the result with `tool_name`, not a `tool_call_id`). Successful `write_file`/`edit_file` calls also record a per-file description from the assistant's preceding prose (falling back to the tool result) for the update report; this description and the final report are both passed through `stripThinkingTags` so reasoning blocks do not leak into PR bodies.
6. Loop up to `WIKI_RECURSION_LIMIT` iterations (default `200`). A response with no tool calls ends the loop.
7. After the loop, call `createWorkflowFile`, `synchronizeWikiIndexes(.wiki)`, write `.wiki/.last-updated.json`, `.wiki/.last-update-report.md` (via `generateUpdateReport`), and `.wiki/.last-update-title.txt` (via `generateUpdateTitle`), then emit a `done` event. The write/edit tools themselves strip reasoning/thinking tags from persisted content before it reaches disk.

Errors from the underlying LLM SDK (Ollama or OpenAI) are surfaced through the `error` event stream. If the model had already produced content, the loop exits with a `done` summary that includes the error message; otherwise it emits `error` and stops.

## Streaming and headless

`runAgent` accepts a `stream` option and a `wikiPublish` flag:

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

All write operations are constrained to `.wiki/`. `resolveWikiPath` in `tools.ts` rejects any path whose absolute resolution escapes the `.wiki/` directory. Read-only tools (`read_file`, `ls`, `grep`, `glob`, `git`, `ast_grep`, `ast_search`, `gh`) are constrained to the project root. The `git` tool is limited to a read-only subcommand allowlist and rejects shell metacharacters; the `gh` tool is limited to read-only inspection plus `pr close`/`pr comment` only on `wiki/staging-*` PRs. All process-executing tools (`grep`, `glob`, `git`, `gh`, `ast_grep`, `ast_search`) invoke external binaries through `execFileAsync` (array arguments, no shell), which prevents command injection through model-controlled input. The old general-purpose `execute` shell tool has been removed.

Tool results are truncated at `MAX_TOOL_RESULT_LENGTH` (10 000 characters) before being returned to the model. `read_file` streams lines with `createReadStream` + `readline` and aborts as soon as the requested `offset + limit` slice is reached, so it does not load large files into memory when only a small range is needed.

## TUI flow

`cli.tsx` chooses between two runtimes after parsing args and resolving config:

- If `config.mode` is `"cloud"` or `"openai"` and no API key is present, `App` renders `CredentialsSetup` first. The user selects local Ollama, Ollama Cloud, or OpenAI-compatible, enters the API key (cloud/openai only), and a model ID. The result is persisted to `~/.wiki/config.json` and re-resolved.
- Once configured, `App` renders a header and the `RunView` component, which wires the agent's `onEvent` callback to a stateful list of display events. `q` or `Ctrl+C` exits the Ink app at any time.

## Post-run: index synchronization

`index-middleware.ts` walks the `.wiki/` tree and writes an `index.md` for every directory. For each subdirectory it recurses; for each `*.md` file it parses the YAML frontmatter, validates that it is a mapping with sane `title`/`description` scalars, and emits a sorted bulleted list grouped into "Files" and "Directories". `index.md` and `_plan.md` are excluded from listings. If a generated index matches the existing one byte-for-byte, the file is not rewritten.

Entries are processed concurrently in bounded chunks (`CHUNK_SIZE = 16`) within each directory. The cap is per level: every recursive `synchronizeDirectory` call manages its own chunk, so total live concurrency scales with directory depth. Mutating the shared `files`/`directories` arrays from concurrent callbacks is safe because JavaScript runs each callback's synchronous segments to completion, and `renderLinks` sorts by `href` before emitting, making the final output order-independent. Invalid frontmatter does not silently drop the file; the parse error propagates up and aborts the sync, matching the original sequential behavior.

This step is invoked once at the end of `runAgent` — it does not run on every tool call.

## GitHub Wiki publish conversion

The agent keeps its nested `.wiki/` directory structure, but GitHub Wikis require a flat file layout. `src/flatten-wiki.ts` converts the staged tree before the workflow pushes to `<repo>.wiki.git`:

- `.wiki/index.md` → `Home.md`
- `.wiki/architecture/index.md` → `Architecture.md`
- `.wiki/architecture/overview.md` → `Architecture-Overview.md`
- `.wiki/cli/usage.md` → `CLI-Usage.md`
- Internal links are rewritten from relative `.md` paths to flat wiki page names, e.g. `[Text](./cli/usage.md)` → `[Text](CLI-Usage)`.
- `_Sidebar.md` is generated automatically from the page structure.
- Metadata files (`.last-update-report.md`, `.last-updated.json`, `.last-update-title.txt`, `config.json`, `_plan.md`) are excluded from the flatten.

This step is invoked by `.github/workflows/update-wiki.yml` (when `--wiki` was passed to `--init`) immediately before the wiki repo is cloned and rsynced. See [GitHub Actions](../automation/github-actions.md).

## Build and test

`tsconfig.json` targets `ES2022` with `nodenext` modules and `react-jsx`. `bun run build` cleans `dist/` and runs `tsc`; `bun run test` runs `vitest` over the test suite in `test/`. `bun pm pack` produces the npm tarball. See [Development](../development.md) for the full command reference, test matrix, and release workflow details.
