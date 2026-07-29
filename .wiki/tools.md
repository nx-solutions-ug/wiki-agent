---
type: Reference
title: Tools
description: The file and discovery tools exposed to the model, their parameters, and sandboxing rules.
tags: [tools, filesystem, sandbox]
---

# Tools

The agent in `src/agent.ts` does not speak to the filesystem directly. It receives a list of tool definitions built by `createTools(projectRoot)` in `src/tools.ts` and forwards them as the `tools` field of every Ollama `chat` request. The model returns `tool_calls`, the runtime normalizes the arguments (`normalizeToolCallArgs`) and dispatches them through `executeTool`.

All tools are local to the runtime; no network calls are made by the tools themselves. The agent loop in `src/agent.ts` tracks successful `write_file` and `edit_file` calls, captures the assistant's preceding prose as a per-file change description, and feeds them to `generateUpdateReport` for the PR body. The same loop also writes `.wiki/.last-update-title.txt` with a generated title for the staging PR.

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
| `gh` | Run a GitHub CLI (`gh`) subcommand. Read-only inspection by default; `pr close`/`pr comment` allowed only on wiki staging PRs. | No |

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

The handler reads the file with a `createReadStream` + `readline` pipeline, streaming lines lazily and stopping as soon as `offset + limit` lines have been seen. This avoids loading a massive file into memory when only a small slice is requested. The collected lines are joined and passed through the tool-result truncator. The path is verified to stay inside the project root.


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

Runs `grep -rn --exclude-dir=… --include=… -- <pattern> <path>` via `execFileAsync`, bypassing the shell entirely so model-controlled `pattern`/`path` values cannot trigger command injection. The include filter defaults to a broad set of source and config extensions when `glob` is not provided, with each `--include=` passed as a separate argv element.

To avoid severe disk I/O from traversing massive generated/VCS directories, the search always excludes `node_modules`, `.git`, `dist`, and `.wiki` via `--exclude-dir=`. Matches are returned, capped at the standard truncation length.

## `glob`

```json
{
  "pattern": "*.ts",
  "path": "src"
}
```

Uses the system `find` command, which searches recursively from the given path. The pattern is matched against basenames only (`find -name`), not full paths; use the `path` parameter to scope to a subdirectory. Leading `**/` and internal `**/` sequences in the pattern are stripped before being handed to `find -name`, because the tool only supports single-segment wildcards.

`find` is invoked with `-type f` and prunes the same massive/generated/VCS directories as `grep`: `node_modules`, `.git`, `dist`, and `.wiki` (via `-not -path */<dir>/*`).

## `git`

```json
{ "args": "log --oneline -30" }
```

Runs a read-only git subcommand with `cwd` set to the project root, a 1 MB output buffer, and a 30-second timeout. Stdout is returned; stderr is appended on a new line. Errors are caught and returned as `Error: <message>` strings.

The tool is intentionally constrained — it is the only way the agent reaches repository history, and it is not a general shell:

- **Subcommand allowlist**: only `log`, `diff`, `show`, `ls-files`, `blame`, `status`, `remote`, `describe`, `rev-parse`, `shortlog`, `name-rev`, `ls-tree`, `cat-file`, and `reflog` are permitted. Any other subcommand (e.g. `commit`, `rm`, `push`) returns `Error: git subcommand '<name>' is not permitted.`
- **Metacharacter guard**: the argument string is rejected if it contains shell-control or redirection metacharacters (`[;&|\`$()<>]`). This prevents command chaining and flag injection even within an allowed subcommand.
- **Shell bypass**: arguments are parsed into an argv array and passed to `execFileAsync`, which executes `git` directly without invoking a shell. This removes the possibility of command injection through the argument string entirely.

The `execute` shell tool that previously allowed arbitrary commands was removed from the tool catalog.

## `gh`

```json
{
  "args": "pr list --state open --json number,headRefName,title"
}
```

Runs a GitHub CLI (`gh`) subcommand with `cwd` set to the project root, a 1 MB output buffer, and a 30-second timeout. Stdout is returned; stderr is appended on a new line. Errors are caught and returned as `Error: <message>` strings.

The tool is constrained the same way as the `git` tool:

- **Subcommand allowlist**: only `pr`, `issue`, `repo`, `run`, `api`, `search`, `release`, `label`, and `workflow` are permitted.
- **Blocked actions**: mutating action tokens are rejected even under an allowed top-level command. Blocked actions include `create`, `edit`, `reopen`, `merge`, `delete`, `ready`, `review`, `lock`, `unlock`, `assign`, `unassign`, `label`, `unlabel`, `transfer`, `archive`, `unarchive`, `deploy`, `rerun`, `cancel`, `publish`, `set`, `add`, and `remove`. So `gh pr list` and `gh pr view` are allowed, but `gh pr create`, `gh pr merge`, and `gh issue close` are rejected.
- **Staging-only exceptions**: `pr close` and `pr comment` are allowed, but only when the target PR's `headRefName` starts with `wiki/staging-`. The handler verifies this by calling `gh pr view <number> --json headRefName` before executing the action.
- **Metacharacter guard**: the argument string is rejected if it contains shell-control or redirection metacharacters (`[;&|\`$()<>]`).

`gh` is also invoked through `execFileAsync`, so shell metacharacters cannot bypass the allowlist by way of command substitution or chaining.

Read-only inspection (`pr list`, `pr view`, `repo view`, `issue list`, etc.) is always allowed. The update-mode staging PR staleness check uses this tool to list open `wiki/staging-*` PRs and compare branch timestamps against the latest commit timestamp, then close any stale ones with a comment before proceeding. See [CLI Usage](../cli/usage.md) for the `GH_TOKEN` environment variable used by the workflow.

## Argument parsing helper

`tools.ts` also exports `parseArgsStringToArgv` for safely splitting an argument string into an argv array (handling quotes, escapes, and whitespace). It is covered by `test/tools.test.ts` and is used internally by the `git`/`gh` command runners.

## `ast_grep`

```json
{
  "pattern": "console.log($$)",
  "lang": "typescript",
  "path": "src"
}
```

Searches code by AST structure (not text) using `@ast-grep/cli` (`ast-grep run --json=compact`). Requires a `pattern` and a `lang`. Arguments are passed directly via `execFileAsync`, bypassing the shell.

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

Searches code using an inline ast-grep YAML rule (`ast-grep scan --json=compact --inline-rules`). More powerful than `ast_grep`: supports relational/inside/has constraints and multiple rules separated by `---`. Arguments are passed directly via `execFileAsync`, bypassing the shell, and the tool validates that `rule` is a valid YAML structure containing `id`, `language`, and `rule`/`rules` fields.

- `rule` — inline YAML rule(s), each with `id`, `language`, and `rule` fields (required).
- `path` — relative path to search in (default `.`), resolved via `resolveProjectPath`.

Output and error handling match `ast_grep`.

## Sandboxing summary

- `read_file`, `ls`, `grep`, `glob`, `git`, `ast_grep`, `ast_search`, `gh` — must stay within the project root.
- `write_file`, `edit_file` — must stay within `.wiki/`.
- `gh` — read-only inspection is allowed; `pr close` and `pr comment` are permitted only on wiki staging PRs (branches matching `wiki/staging-*`).
- `grep`, `glob`, `git`, `gh`, `ast_grep`, and `ast_search` use `execFileAsync` and are not vulnerable to shell command injection via their argument strings.
- `grep` and `glob` share one directory exclusion list (`node_modules`, `.git`, `dist`, `.wiki`) so they never waste I/O traversing massive generated or VCS trees.

Both checks use `path.resolve` and a `startsWith` comparison against the appropriate root plus the platform separator. The tests in `test/tools.test.ts` cover both the in-bounds and out-of-bounds cases, the `git` and `gh` subcommand allowlists and metacharacter guard, `grep`/`glob` command-injection prevention and directory exclusions, `ast_grep`/`ast_search` structural matching, the absence of the old general-purpose `execute` shell tool, and reasoning-tag stripping (see below).

## Reasoning-tag stripping

Models that expose chain-of-thought output sometimes wrap reasoning in XML-like tags. Before any content is persisted to `.wiki/`, `src/tools.ts:stripThinkingTags` removes blocks wrapped in `<think>`, `<thinking>`, `<reasoning>`, or `<reflection>` tags, plus any orphaned leftovers. It strips matched open/close pairs by name, then trims leading whitespace left behind by a removed leading block.

This sanitization runs automatically in the two write tools:

- `write_file` strips tags from `args.content` before writing.
- `edit_file` strips tags from `args.new_string` before replacing `old_string`.

`src/agent.ts` also runs `stripThinkingTags` on the assistant prose used for per-file change descriptions and on the generated `.last-update-report.md`, so reasoning blocks do not leak into PR bodies. Content without any thinking tags is returned unchanged.

