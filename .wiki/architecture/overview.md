---
type: Architecture
title: Architecture Overview
description: How Wiki Agent is organized — the agent loop, tools, TUI, and post-run index synchronization.
tags: [architecture, agent, ollama]
---

# Architecture Overview

Wiki Agent is a small, single-purpose Node.js application. The runtime model is "an LLM with a constrained tool belt that writes markdown into `.wiki/`." There is no LangChain, no vector store, no long-lived memory — just a manual tool-calling loop against the configured provider's chat API (Ollama or OpenAI-compatible).

## Run metadata gitignore

`runAgent` writes `.wiki/.gitignore` on every run so transient files stay out of git history. The gitignore covers the three run-metadata files (`.last-updated.json`, `.last-update-report.md`, `.last-update-title.txt`) and the binary embeddings database plus its SQLite sidecar files (`wiki.db`, `wiki.db-journal`, `wiki.db-wal`, `wiki.db-shm`). The agent also untracks any of these files that were already committed in legacy repositories.

## Top-level layout

The compiled entrypoint is `dist/cli.js` (declared as the `wiki` binary in `package.json`). A second binary, `wiki-flatten` (`dist/flatten-wiki.js`), is produced for GitHub Wiki publishing. Source lives under `src/`:

- `cli.tsx` — argument parsing, TUI vs. headless dispatch
- `agent.ts` — the agent loop, tool calling, event stream, workflow/report generation
- `config.ts` — global/project config, provider client factory (`createLLMClient`)
- `llm.ts` — provider adapter interface plus `OpenAIAdapter` and `OllamaAdapter`
- `prompt.ts` — system prompt, user message templates, help text; reads `AGENTS.md`/`CLAUDE.md` with `Promise.allSettled`
- `tools.ts` — file and discovery tools exposed to the model
- `index-middleware.ts` — post-run regeneration of `index.md`
- `flatten-wiki.ts` — converts nested `.wiki/` to flat GitHub Wiki format before publish
- `version.ts` — reads `package.json` version for `--version` and the TUI banner
- `tui/` — Ink-based terminal UI (`App`, `CredentialsSetup`, `RunView`)

See [Configuration](../configuration.md) for the data model, [Tools](../tools.md) for the agent's toolbelt, and [CLI Usage](../cli/usage.md) for how the `--wiki` and `--print` flags reach the loop.

## The agent loop

`runAgent` in `agent.ts` implements the entire control flow:

1. Build the system prompt (`createSystemPrompt`) and the user message (`createUserMessage`) for the chosen command — `init` or `update`. `createSystemPrompt` embeds repo instructions from `AGENTS.md`/`CLAUDE.md` if either exists.
2. Construct the provider `chat` request with the current `messages` array and the tool definitions.
3. Stream or batch the response. Collect `content` and any `tool_calls` returned by the model.
4. Append the assistant message to the history. If there are tool calls, append a `tool` message per call; Ollama uses `tool_name`, while OpenAI uses `tool_call_id`.
5. Loop up to `WIKI_RECURSION_LIMIT` iterations (default `200`). A response with no tool calls ends the loop.
6. After the loop, call `createWorkflowFile` in `src/workflow.ts`, `synchronizeWikiIndexes(.wiki)`, write `.wiki/.last-update-report.md` (via `generateUpdateReport`) and `.wiki/.last-update-title.txt` (via `generateUpdateTitle`), then emit a `done` event. The write/edit tools themselves strip reasoning/thinking tags from persisted content and inject `last_updated`/`updated_by` frontmatter before it reaches disk. On `init`, the loop also appends/updates a wiki-agent section in `AGENTS.md`/`CLAUDE.md` via `appendWikiAgentFrontmatter`, and writes `.wiki/.gitignore` to keep run metadata and the embeddings database out of git.

Errors from the LLM SDK are surfaced through the `error` event stream. If the model had already produced content, the loop exits with a `done` summary that includes the error message; otherwise it emits `error` and stops.

`runAgent` also writes `.wiki/.gitignore` on every run so run-metadata files (`/.last-update-report.md`, `/.last-update-title.txt`) stay out of git history, and it untracks any of those files that were already committed in legacy repos.

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

## Embeddings and MCP server

Two newer modules extend the core agent without changing the main loop:

- `src/embeddings.ts` provides pluggable text embeddings (`local` via Hugging Face Transformers.js, or `ollama` via the Ollama embeddings API) and a `better-sqlite3` + `sqlite-vec` vector store persisted as `.wiki/wiki.db`. It supports chunking wiki pages, incremental `syncEmbeddings`, and `k`-nearest-neighbor semantic search over the wiki.
- `src/mcp-server.ts` exposes Wiki Agent as an MCP server over stdio (`wiki --mcp stdio`). Tools include `read_wiki_page`, `list_wiki_pages`, `search_wiki`, `update_wiki`, `rebuild_embeddings`, and `sync_embeddings`. The server reuses `resolveConfig` and `createEmbeddingConfig` for provider/embedding setup.

Both modules are covered by tests (`embeddings.test.ts`, `embedding-config.test.ts`, `mcp-server.test.ts`). The embeddings database and its sidecar files are gitignored so they are not committed or published.

## Tool sandboxing

All write operations are constrained to `.wiki/`. `resolveWikiPath` in `tools.ts` rejects any path whose absolute resolution escapes the `.wiki/` directory. Read-only tools (`read_file`, `ls`, `grep`, `glob`, `git`, `ast_grep`, `ast_search`, `gh`) are constrained to the project root. The `git` tool is limited to a read-only subcommand allowlist and rejects shell metacharacters; the `gh` tool is limited to read-only inspection plus `pr close`/`pr comment` only on `wiki/staging-*` PRs. All process-executing tools (`grep`, `glob`, `git`, `gh`, `ast_grep`, `ast_search`) invoke external binaries through `execFileAsync` (array arguments, no shell), which prevents command injection through model-controlled input. The old general-purpose `execute` shell tool has been removed.

Tool results are truncated at `MAX_TOOL_RESULT_LENGTH` (10 000 characters) before being returned to the model. `read_file` streams lines with `createReadStream` + `readline` and aborts as soon as the requested `offset + limit` slice is reached, so it does not load large files into memory when only a small range is needed.

## TUI flow

`cli.tsx` chooses between two runtimes after parsing args and resolving config:

- If `config.mode` is `"cloud"` or `"openai"` and no API key is present, `App` renders `CredentialsSetup` first. The user selects local, cloud, or openai-compatible; enters the API key when required; optionally overrides the base URL; and enters a model ID. The result is persisted to `~/.wiki/config.json` and re-resolved.
- Once configured, `App` renders a header and the `RunView` component, which wires the agent's `onEvent` callback to a stateful list of display events. `q` or `Ctrl+C` exits the Ink app at any time.

See [Terminal UI](../tui.md) for the complete wizard and key bindings.

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
- Metadata files (`.last-update-report.md`, `.last-update-title.txt`, `config.json`, `_plan.md`) are excluded from the flatten.

This step is invoked by `.github/workflows/update-wiki.yml` (when `--wiki` was passed to `--init`) immediately before the wiki repo is cloned and rsynced. See [GitHub Actions](../automation/github-actions.md).

## Build and test

`tsconfig.json` targets `ES2022` with `nodenext` modules and `react-jsx`. `bun run build` cleans `dist/` and runs `tsc`; `bun run test` runs `vitest` over the test suite in `test/`. `bun pm pack` produces the npm tarball. See [Development](../development.md) for the full command reference, test matrix, and release workflow details.
