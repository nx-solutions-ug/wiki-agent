---
type: Reference
title: Tools
description: The file and discovery tools exposed to the model, their parameters, and sandboxing rules.
tags: [tools, filesystem, sandbox]
---

# Tools

The agent in `src/agent.ts` does not speak to the filesystem directly. It receives a list of tool definitions built by `createTools(projectRoot)` in `src/tools.ts` and forwards them as the `tools` field of every Ollama `chat` request. The model returns `tool_calls`, the runtime normalizes the arguments (`normalizeToolCallArgs`) and dispatches them through `executeTool`.

All tools are local to the runtime; no network calls are made by the tools themselves. The agent loop in `src/agent.ts` tracks successful `write_file` and `edit_file` calls, captures the assistant's preceding prose as a per-file change description, and feeds them to `generateUpdateReport` for the PR body.

## Tool catalog

| Name | Purpose | Writes? |
|------|---------|---------|
| `read_file` | Read a file by relative path with offset/limit. | No |
| `write_file` | Create or overwrite a file under `.wiki/`. | Yes (`.wiki/` only) |
| `edit_file` | Find-and-replace a string in an existing `.wiki/` file. | Yes (`.wiki/` only) |
| `ls` | List a directory's entries. | No |
| `grep` | Recursive text search using system `grep`. | No |
| `glob` | Find files by name using system `find`. | No |
| `git` | Run a read-only git subcommand in the project root. | No (whitelisted subcommands only) |
| `ast_grep` | Search code by AST pattern using `ast-grep`. | No |
| `ast_search` | Search code using an inline `ast-grep` YAML rule. | No |

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

## `git`

```json
{ "args": "log --oneline -30" }
```

Runs a read-only git subcommand with `cwd` set to the project root, a 1 MB output buffer, and a 30-second timeout. Stdout is returned; stderr is appended on a new line. Errors are caught and returned as `Error: <message>` strings.

The tool is intentionally constrained — it is the only way the agent reaches repository history, and it is not a general shell:

- **Subcommand allowlist**: only `log`, `diff`, `show`, `ls-files`, `blame`, `status`, `remote`, `describe`, `rev-parse`, `shortlog`, `name-rev`, `ls-tree`, `cat-file`, and `reflog` are permitted. Any other subcommand (e.g. `commit`, `rm`, `push`) returns `Error: git subcommand '<name>' is not permitted.`
- **Metacharacter guard**: the argument string is rejected if it contains shell-control or redirection metacharacters (`[;&|\`$()<>]`). This prevents command chaining and flag injection even within an allowed subcommand.

This replaced the older general-purpose `execute` shell tool; there is no longer any way for the model to run arbitrary host commands.

## `ast_grep`

```json
{
  "pattern": "console.log($$)",
  "lang": "typescript",
  "path": "src"
}
```

Searches code by AST structure (not text) using `@ast-grep/cli` (`ast-grep run --json=compact`). Requires a `pattern` and a `lang`.

- `pattern` — AST pattern; `$NAME` matches a single node, `$$ARGS` matches zero-or-more nodes (required).
- `lang` — one of the supported languages: `bash, c, cpp, csharp, css, elixir, go, haskell, html, java, javascript, json, jsx, kotlin, lua, nix, php, python, ruby, rust, scala, solidity, swift, tsx, typescript, yaml` (required).
- `path` — relative path to search in (default `.`), resolved via `resolveProjectPath`.
- `selector` — optional AST kind to extract as the actual matcher (`ast-grep --selector`).
- `strictness` — optional pattern strictness: `cst, smart, ast, relaxed, signature, template`.

Output is the compact JSON array from ast-grep, truncated at `MAX_TOOL_RESULT_LENGTH`. `(no matches)` is returned when there is no output. Errors are returned as `Error: <message>`.

## `ast_search`

```json
{
  "rule": "id: find-foo\nlanguage: typescript\nrule:\n  pattern: export function foo() {}",
  "path": "src"
}
```

Searches code using an inline ast-grep YAML rule (`ast-grep scan --json=compact --inline-rules`). More powerful than `ast_grep`: supports relational/inside/has constraints and multiple rules separated by `---`.

- `rule` — inline YAML rule(s), each with `id`, `language`, and `rule` fields (required).
- `path` — relative path to search in (default `.`), resolved via `resolveProjectPath`.

Output and error handling match `ast_grep`.

## Sandboxing summary

- `read_file`, `ls`, `grep`, `glob`, `git`, `ast_grep`, `ast_search` — must stay within the project root.
- `write_file`, `edit_file` — must stay within `.wiki/`.

Both checks use `path.resolve` and a `startsWith` comparison against the appropriate root plus the platform separator. The tests in `test/tools.test.ts` cover both the in-bounds and out-of-bounds cases, plus the `git` subcommand allowlist, the metacharacter guard, and `ast_grep`/`ast_search` structural matching.
