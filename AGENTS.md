# Repository Guidelines

## Project Overview

Wiki Agent is a standalone Ollama-only documentation agent. It inspects a repository's source code and generates a wiki under `.wiki/` in the project root. It uses the native `ollama` SDK (no LangChain), supports local Ollama or Ollama Cloud, and ships both an interactive TUI (Ink/React) and a headless `--print` mode for CI. Two commands: `--init` creates docs from scratch (and writes a GitHub Actions workflow), `--update` refreshes existing docs.

The agent runs a manual tool-calling loop against the Ollama chat API — there is no agent framework dependency. It reads `AGENTS.md` or `CLAUDE.md` from the project root and follows the conventions documented there (this file is that contract for this repo).

## Architecture & Data Flow

```
cli.tsx (entry, bin: ./dist/cli.js)
  ├── parseArgs → --init | --update, --print, --model, --help
  ├── resolveConfig (config.ts) → merges env vars > global > project > defaults
  ├── --print? → runHeadless → runAgent (stream:false, events→stdout)
  └── else    → inkRender(<App>) → CredentialsSetup | RunView
                                          └── runAgent (stream:true, events→UI)
```

**Agent loop** (`src/agent.ts`, `runAgent`):
1. Builds system prompt (`prompt.ts:createSystemPrompt`) — embeds repo instructions from `AGENTS.md`/`CLAUDE.md`.
2. Builds user message (`prompt.ts:createUserMessage`) — `init` or `update`, with a `git log --oneline -30` summary.
3. Sends messages to Ollama `client.chat()` with tool definitions (`tools.ts:createTools`).
4. Receives assistant content + tool calls. Normalizes tool-call args (handles both JSON strings and parsed objects — models vary).
5. Executes each tool via `tools.ts:executeTool`, appends results as `role: "tool"` messages with `tool_name` (Ollama uses `tool_name`, not `tool_call_id`).
6. Tracks `write_file`/`edit_file` calls into `changedFiles[]` for the update report.
7. Loops until no tool calls are returned or `maxIterations` (env `WIKI_RECURSION_LIMIT`, default `200`) is hit.
8. After loop: `synchronizeWikiIndexes` (`index-middleware.ts`) regenerates every `index.md`, writes `.last-updated.json` and `.last-update-report.md`.
9. On `init`: also writes `.github/workflows/update-wiki.yml` via `createWorkflowFile`.

**Index middleware** (`src/index-middleware.ts`): recursively walks `.wiki/`, parses YAML frontmatter from each `.md` (title/description), and renders one `index.md` per directory listing files and subdirectories. Excludes `index.md` and `_plan.md` from collection.

## Key Directories

```
src/
  cli.tsx                # CLI entry point — arg parsing, TUI vs headless dispatch
  agent.ts               # Manual tool-calling loop, workflow/report generation
  tools.ts               # File/discovery tools exposed to the model + path safety
  config.ts              # Global/project config resolution, Ollama client factory
  prompt.ts              # System prompt + user message construction
  index-middleware.ts    # index.md synchronization per wiki directory
  tui/
    App.tsx              # Root component — header, routes setup↔run
    CredentialsSetup.tsx # Wizard: mode (local/cloud) → API key → model
    RunView.tsx          # Agent event rendering, starts runAgent in useEffect
test/
  tools.test.ts          # Tool execution, path safety, self-invocation guard
  config.test.ts         # Config load/save, resolveConfig precedence
  prompt.test.ts         # System prompt content assertions
  index-middleware.test.ts # index.md generation from frontmatter
.wiki/                   # Self-generated wiki for this repo (the product's own output)
.github/workflows/        # Empty here — workflow is written into target repos by --init
```

## Development Commands

```bash
# Install deps
bun install

# Build (prebuild runs clean → rm -rf dist)
npm run build            # tsc -p tsconfig.json → dist/

# Test
npm test                 # vitest run
bun run test             # equivalent

# Pack a local tarball (for global install / testing)
bun pm pack              # produces wiki-agent-<version>.tgz

# Install globally from local tarball
cd ~/.bun/install/global && bun add /path/to/wiki-agent/wiki-agent-0.1.0.tgz

# Run locally against a target project
cd your-project && node /path/to/wiki-agent/dist/cli.js --init
# Or once installed globally:
wiki --init
wiki --update --print --model llama3.2
```

## Code Conventions & Common Patterns

**TypeScript**: strict mode, ES2022 target, `nodenext` module resolution. `noUnusedLocals`/`noUnusedParameters` are deliberately `false` (don't rely on them as lint). `rootDir: src`, `outDir: dist`. JSX is `react-jsx` (for the `.tsx` TUI).

**Naming**: files kebab-case (`index-middleware.ts`); functions camelCase (`runAgent`, `resolveConfig`); types/interfaces PascalCase (`AgentEvent`, `ResolvedConfig`); constants UPPER_SNAKE (`DEFAULT_MODEL`, `MAX_TOOL_RESULT_LENGTH`).

**Imports**: ES modules with `.js` extensions on relative imports (required by `nodenext`):
```typescript
import { runAgent } from "./agent.js";
import { saveGlobalConfig, type GlobalConfig } from "../config.js";
```
Node built-ins use the `node:` prefix (`node:fs/promises`, `node:path`, `node:child_process`).

**Async**: all I/O is `async/await`. No raw `.then()` chains. Tool handlers return `Promise<string>`.

**Error handling**: tool execution catches errors and returns them as string `Error: <message>` results to the model — tools never throw to the agent loop. The agent loop catches `client.chat` failures and emits an `error`/`done` event. Path-safety violations throw inside handlers but are caught by `executeTool`'s try/catch and returned as error strings. Example pattern (`tools.ts:executeTool`):
```typescript
try {
  return await tool.handler(args, projectRoot);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  return `Error: ${message}`;
}
```

**Path safety** (two-tier, in `tools.ts`):
- `resolveWikiPath` — for writes. Resolves relative to project root and enforces the result stays under `.wiki/`. Throws on escape (`../`, absolute paths outside).
- `resolveProjectPath` — for reads. Enforces the result stays within the project root. Used by `read_file`, `ls`, `grep`, `glob`.

**Self-invocation guard**: the `execute` tool blocks commands matching `/\b(wiki\b|wiki-agent|dist\/cli\.js)/i` to prevent the agent recursively spawning itself.

**Result truncation**: all tool results are truncated to `MAX_TOOL_RESULT_LENGTH = 10_000` chars (`truncateResult`); file reads also cap at `MAX_READ_LENGTH = 50_000`.

**Config resolution precedence** (`config.ts:resolveConfig`), highest first:
1. Env vars: `WIKI_OLLAMA_MODE`, `WIKI_OLLAMA_API_KEY`, `WIKI_OLLAMA_BASE_URL`, `WIKI_MODEL`
2. CLI `--model` flag
3. Project config `.wiki/config.json` (`modelOverride`)
4. Global config `~/.wiki/config.json`
5. Built-in defaults (`mode: "local"`, `model: "kimi-k2.7-code"`, local `http://localhost:11434`, cloud `https://ollama.com`)

Note: `resolveConfig` reads env vars and global config in the same pass — env wins over global for each field independently.

**Event model** (`agent.ts:AgentEvent`): a discriminated union the agent emits via the `onEvent` callback:
```typescript
type AgentEvent =
  | { type: "assistant"; content: string }
  | { type: "tool"; name: string; result: string }
  | { type: "error"; message: string }
  | { type: "done"; summary: string };
```
Headless mode (`cli.tsx:runHeadless`) prints these to stdout/stderr; the TUI (`RunView.tsx`) converts them to `DisplayEvent` and renders.

**TUI pattern** (Ink/React): components use `React.createElement` (not JSX) throughout. The agent run is kicked off inside `RunView`'s `useEffect` with `stream: true`; events accumulate in a `useRef` + `useState` pair. `App` watches for `q`/Ctrl-C via `useInput` and calls `useApp().exit()`.

## Important Files

| File | Role |
|------|------|
| `src/cli.tsx` | CLI entry (`bin: ./dist/cli.js`). `parseArgs`, `runHeadless`, `main`. Top-level error boundary. |
| `src/agent.ts` | `runAgent(client, RunOptions)` — the core loop. `AgentEvent`, `RunOptions`, `createWorkflowFile`, `generateUpdateReport`. |
| `src/tools.ts` | `createTools(projectRoot): Tool[]` — all 7 model tools. `executeTool(name, args, projectRoot)` — dispatcher. `Tool` interface (`{ definition, handler }`). |
| `src/config.ts` | `resolveConfig`, `createOllamaClient`, `loadGlobalConfig`/`saveGlobalConfig`, `loadProjectConfig`/`saveProjectConfig`. `GlobalConfig`, `ProjectConfig`, `ResolvedConfig`, `OllamaMode`. |
| `src/prompt.ts` | `createSystemPrompt(projectRoot)` — reads `AGENTS.md`/`CLAUDE.md` (first match wins), embeds them. `createUserMessage`, `getHelpText`, `WikiCommand` type. |
| `src/index-middleware.ts` | `synchronizeWikiIndexes(wikiRoot)` — regenerates per-directory `index.md` from frontmatter. |
| `src/tui/App.tsx` | Root Ink component; routes to `CredentialsSetup` when cloud mode lacks an API key. |
| `src/tui/RunView.tsx` | Starts `runAgent` in `useEffect`, renders event stream. |
| `src/tui/CredentialsSetup.tsx` | Multi-step wizard (`mode-select → api-key → model → saving`). |
| `package.json` | `bin`, scripts, deps, `engines.node >=22`. |
| `tsconfig.json` | strict, ES2022, nodenext, jsx `react-jsx`. |


## Known Source Inconsistencies

These are present in the source as of this writing — be aware when editing:

- **Workflow filename mismatch**: `package.json` `files` (line 12) lists `.github/workflows/wiki-update.yml`, but `src/agent.ts:createWorkflowFile` (lines 255, 333) writes `.github/workflows/update-wiki.yml`. The `package.json` entry is stale — it references a file the build never ships. If you touch either, reconcile the names.
- **Stale model hint in TUI**: `src/tui/CredentialsSetup.tsx:106` renders "Press Enter to use the default (qwen3-coder)", but the actual initial state (line 19) and `config.ts:DEFAULT_MODEL` are both `kimi-k2.7-code`. The hint text is out of date.

## Runtime/Tooling Preferences

- **Runtime**: Node.js **>=22** is the execution runtime (CI runs `node dist/cli.js`). Bun is the package manager and packer (`bun.lock`, `bun pm pack`). Both are first-class: Node runs the compiled CLI; Bun manages deps and packs the tarball.
- **Package manager**: Bun (`bun install`, `bun.lock`). Do not introduce a `package-lock.json` or `yarn.lock`.
- **Build**: `tsc -p tsconfig.json` only — no bundler, no swc. Output is plain CommonJS-compatible ESM in `dist/`.
- **Test runner**: Vitest 4 (`vitest run`). No coverage config; use `--coverage` ad hoc if needed.
- **Renovate**: `config:recommended`, no custom rules.
- **Self-hosting note**: this repo's `.wiki/` is its own product's output. When working here, treat `.wiki/` as generated artifacts, not hand-authored docs — regenerate via `wiki --update` rather than editing by hand.

## Testing & QA

**Framework**: Vitest 4. Tests in `test/` import source directly from `../src/<file>.ts` (not the built `dist/`).

**Structure**: `describe`/`test` blocks, descriptive names reflecting behavior (`write_file rejects paths outside .wiki/`). Assertions use `expect().toBe()`, `.toContain()`, `.toBeTruthy()`.

**Fixtures**: every test file uses a `tempDir()` helper (`mkdtemp` under `os.tmpdir()`) with `beforeEach`/`afterEach` cleanup:
```typescript
function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "wiki-tools-test-"));
}
beforeEach(async () => { projectRoot = await tempDir(); });
afterEach(async () => { await rm(projectRoot, { recursive: true, force: true }); });
```
`config.test.ts` additionally stubs `process.env.HOME` to isolate the global config file (`~/.wiki/config.json`), restoring it in `afterEach`.

**What's tested**: tools (path safety, read/write/edit, self-invocation guard), config (load/save/resolve precedence), prompt (content assertions for role, frontmatter, loop-prevention section), index-middleware (frontmatter→index rendering). No integration tests touch the Ollama SDK — it is not mocked in the suite; tests cover the deterministic filesystem/config/prompt logic.

**Running**:
```bash
npm test                 # full suite
npx vitest run test/tools.test.ts   # single file
```

**Adding tests for a new feature**: follow the `tempDir` + `beforeEach`/`afterEach` pattern. Import the function directly from `src/`. Keep tests deterministic and filesystem-isolated — no network calls, no real Ollama client.