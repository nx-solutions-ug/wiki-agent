# Sentinel's Journal — Critical Security Learnings

## 2026-07-28 - Command injection via execAsync in tool handlers

**Vulnerability:** The `grep` and `glob` tools in `src/tools.ts` used `execAsync` (`child_process.exec`) with model-controlled input interpolated into shell command strings. The `searchPath` (from model-supplied `path` arg) was passed raw — no shell escaping at all — enabling arbitrary command injection via paths like `.; rm -rf /tmp/important #`.

**Learning:** This existed because the `git` and `gh` tools were already hardened with `execFileAsync` (array-based, no shell), but `grep`/`glob`/`ast_grep`/`ast_search` were left on `execAsync` with ad-hoc quoting. The `glob` tool even stripped all `*` wildcards as a crude injection workaround, which broke its functionality without fully preventing injection. The pattern to remember: **any tool that executes external commands must use `execFileAsync` with array arguments, never `execAsync` with string concatenation.** Shell escaping is hard to get right; bypassing the shell entirely is the robust fix.

**Prevention:** When adding new tools that shell out, always use `execFileAsync(command, argsArray)` — never `execAsync(commandString)`. Audit existing tools for `execAsync` usage and convert them. A grep for `execAsync(` in tools is a quick vulnerability check.

## 2026-07-28 - grep --include flag requires separate arguments with execFileAsync

**Vulnerability:** When converting `grep` from `execAsync` to `execFileAsync`, the default `--include` patterns (`"*.ts *.tsx *.js *.jsx ..."`) were initially left as a single space-separated string. With `execFileAsync`, this becomes one literal argument `--include=*.ts *.tsx ...` which grep treats as a single pattern — it matches nothing.

**Learning:** `execAsync` joins everything into one shell string, so space-separated values within a single `--include=` flag work (the shell word-splits them... actually no, it wouldn't work correctly there either, but the `--include` was one flag covering all extensions as a glob). With `execFileAsync`, each `--include=` must be a separate array element: `["--include=*.ts", "--include=*.tsx", ...]`. The behavioral difference between shell string execution and array-based execution affects flag handling.

**Prevention:** When converting from `execAsync(cmd.join(" "))` to `execFileAsync(cmd, args)`, carefully audit how multi-value flags work. Split space-separated lists into individual flag arguments.

## 2026-07-28 - Removed remaining execAsync instances

**Vulnerability:** `execAsync` (`child_process.exec`) was still used in `src/cli.tsx` and `test/tools.test.ts`. While not directly exposing user input to shell execution in these specific cases, its presence risks accidental command injection if arguments ever become dynamic or if the pattern is copied elsewhere.

**Learning:** Even internal utility scripts or testing commands should avoid `child_process.exec` to maintain a secure baseline. Using `execFile` avoids the overhead and risks of a shell entirely.

**Prevention:** We have completely purged `execAsync` from the codebase and replaced it with `execFileAsync`. Any new shell executions should follow this pattern by passing arguments as an array to `execFileAsync`.

## 2026-07-28 - Unrestricted arguments in CLI tools

**Vulnerability:** The `git` and `gh` tools use strict whitelists for permitted subcommands but did not restrict the arguments passed to those subcommands. This allowed potentially dangerous mutating flags (`-X`, `--method`, `-f`, `-F`, `--input`) or output redirection (`--output`, `-o`) for otherwise "read-only" subcommands like `git log` or `gh api`. This could lead to arbitrary file writes or unauthorized API state changes.
**Learning:** Even when restricting subcommands using a strict whitelist, the flags passed to them can also pose a significant security risk if not sanitized or restricted properly.
**Prevention:** Always use strict whitelists for permitted actions AND explicitly reject mutating flags or output redirection when implementing or maintaining CLI wrappers, especially for read-only tools.
