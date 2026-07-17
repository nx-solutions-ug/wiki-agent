---
type: Reference
title: Tools
description: The file and discovery tools exposed to the model, their parameters, and sandboxing rules.
tags: [tools, filesystem, sandbox]
---

# Tools

The agent in `src/agent.ts` does not speak to the filesystem directly. It receives a list of tool definitions built by `createTools(projectRoot)` in `src/tools.ts` and forwards them as the `tools` field of every Ollama `chat` request. The model returns `tool_calls`, the runtime normalizes the arguments (`normalizeToolCallArgs`) and dispatches them through `executeTool`.

All tools are local to the runtime; no network calls are made by the tools themselves.

## Tool catalog

| Name | Purpose | Writes? |
|------|---------|---------|
| `read_file` | Read a file by relative path with offset/limit. | No |
| `write_file` | Create or overwrite a file under `.wiki/`. | Yes (`.wiki/` only) |
| `edit_file` | Find-and-replace a string in an existing `.wiki/` file. | Yes (`.wiki/` only) |
| `ls` | List a directory's entries. | No |
| `grep` | Recursive text search using system `grep`. | No |
| `glob` | Find files by name using system `find`. | No |
| `execute` | Run a shell command in the project root. | Indirectly |

## `read_file`

```json
{
  "path": "src/cli.tsx",
  "offset": 0,
  "limit": 500
}
```

- `path` — relative to the project root (required).
- `offset` — 0-indexed line offset, default `0`.
- `limit` — maximum lines to return, default `500`.

The handler splits on newlines, slices `[offset, offset + limit)`, rejoins, and passes through the tool-result truncator. The path is verified to stay inside the project root.

## `write_file`

```json
{
  "path": ".wiki/cli/usage.md",
  "content": "---\ntype: Reference\n..."
}
```

- `path` — must resolve under `.wiki/` (required). Parent directories are created with `mkdir -p`.
- `content` — the full file body (required).

`resolveWikiPath` rejects any path that escapes `.wiki/`, including absolute paths and `..` traversal. The handler returns `Wrote <path>` on success.

## `edit_file`

```json
{
  "path": ".wiki/quickstart.md",
  "old_string": "old text",
  "new_string": "new text"
}
```

- `path` — must resolve under `.wiki/` (required).
- `old_string` — the text to find (required).
- `new_string` — the replacement (required).

The handler reads the file, runs a single `String.prototype.replace`, and writes it back. If the file is unchanged after the replace, it returns `No match found for old_string in <path>` and does not touch the file.

## `ls`

```json
{ "path": "src" }
```

Lists the immediate children of a directory. Directory entries are suffixed with `/`. Sorted alphabetically and truncated like other results.

## `grep`

```json
{
  "pattern": "runAgent",
  "path": "src",
  "glob": "*.ts"
}
```

Builds and runs a `grep -rn --include=…` command. The include filter defaults to a broad set of source and config extensions when `glob` is not provided. Single quotes inside the pattern are escaped; matches and stderr are returned, capped at the standard truncation length.

## `glob`

```json
{
  "pattern": "**/*.ts",
  "path": "src"
}
```

Uses the system `find` command. The pattern is normalized (`**` and `*` are stripped) and `find` is invoked with `-type f` and excludes for `node_modules`, `.git`, and `dist`. The handler does not support full glob semantics — it matches by the file name only, not the path.

## `execute`

```json
{ "command": "git log --oneline -20" }
```

Runs a shell command with `cwd` set to the project root, a 1 MB output buffer, and a 30-second timeout. Stdout is returned; stderr is appended on a new line. Errors from `exec` are caught and returned as `Error: <message>` strings so the model can react rather than crash the loop.

## Sandboxing summary

- `read_file`, `ls`, `grep`, `glob`, `execute` — must stay within the project root.
- `write_file`, `edit_file` — must stay within `.wiki/`.

## Self-invocation guard

`execute` blocks commands that match `\b(wiki\b|wiki-agent|dist/cli\.js)` to prevent the agent from recursively running itself. The block is returned as an error string rather than throwing.

Both checks use `path.resolve` and a `startsWith` comparison against the appropriate root plus the platform separator. The tests in `test/tools.test.ts` cover both the in-bounds and out-of-bounds cases.
