# Wiki Agent

[![npm version](https://img.shields.io/npm/v/@chronova/wiki-agent.svg)](https://www.npmjs.com/package/@chronova/wiki-agent)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

A standalone Ollama-only documentation agent. It inspects your source code and generates a wiki under `.wiki/` in your project root, with optional publishing to the GitHub Wiki tab.

## Features

- **Ollama-only** — uses the native `ollama` SDK, no LangChain dependency
- **Local or Cloud** — connect to a local Ollama server or Ollama Cloud with an API key
- **TUI + Headless** — interactive terminal UI or `--print` for CI/CD
- **Two commands** — `--init` to create docs from scratch, `--update` to refresh existing docs
- **GitHub Wiki tab publishing** — `--wiki` flag generates a workflow that pushes generated pages directly to `<repo>.wiki.git`
- **Configurable** — global config in `~/.wiki/`, project config in `.wiki/`
- **GitHub Actions** — `--init` automatically creates a scheduled update workflow in your repo
- **Repo instructions** — reads `AGENTS.md` or `CLAUDE.md` from the project root and follows all conventions documented there
- **Change reports** — each run writes `.wiki/.last-update-report.md` with created/edited pages, used as the staging PR body in CI
- **Restricted toolset** — the agent can only read files, write under `.wiki/`, and run read-only git subcommands; there is no shell tool

## Quickstart

### 1. Install

Install globally from npm:

```bash
npm install -g @chronova/wiki-agent
```

Or with bun:

```bash
bun add -g @chronova/wiki-agent
```

Verify the install:

```bash
wiki --help
```

### 2. Configure

Run interactively once to set up credentials:

```bash
cd your-project
wiki --init
```

This launches the TUI where you select Ollama Local or Cloud and enter your API key (if cloud). The default model is `kimi-k2.7-code`.

### 3. Use

```bash
# Initialize documentation (also creates .github/workflows/update-wiki.yml)
wiki --init

# Initialize and publish to the GitHub Wiki tab
wiki --init --wiki

# Update existing documentation
wiki --update

# Update and publish to the GitHub Wiki tab
wiki --update --wiki

# Headless mode (for CI)
wiki --update --print

# Headless mode with wiki tab publishing
wiki --update --print --wiki

# Specify a model override
wiki --init --print --model llama3.2
```

## Configuration

### Global config (`~/.wiki/config.json`)

```json
{
  "mode": "local",
  "defaultModel": "kimi-k2.7-code"
}
```

For cloud:

```json
{
  "mode": "cloud",
  "apiKey": "your-api-key",
  "defaultModel": "kimi-k2.7-code"
}
```

### Project config (`.wiki/config.json`)

```json
{
  "modelOverride": "llama3.2",
  "lastUpdate": {
    "commitSha": "abc1234",
    "timestamp": "2026-07-17T00:00:00Z"
  }
}
```

### Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `WIKI_OLLAMA_MODE` | `"local"` or `"cloud"` | from config |
| `WIKI_OLLAMA_API_KEY` | API key for cloud mode | from config |
| `WIKI_OLLAMA_BASE_URL` | Override Ollama server URL | `http://localhost:11434` / `https://ollama.com` |
| `WIKI_MODEL` | Override model ID | from config |
| `WIKI_RECURSION_LIMIT` | Max agent iterations | `200` |

Environment variables take priority over config files.

## GitHub Actions

Running `wiki --init --wiki` automatically creates `.github/workflows/update-wiki.yml` in your repo. With `--wiki`, the workflow publishes generated pages to your repository's **GitHub Wiki tab**; without `--wiki` it only stages `.wiki/` and opens a staging PR.

1. Generates a GitHub App token if `APP_CLIENT_ID` and `APP_PRIVATE_KEY` secrets are set (falls back to `GITHUB_TOKEN`)
2. Checks out your repo, clones and builds wiki-agent from `nx-solutions-ug/wiki-agent`
3. Runs `wiki --update --print --verbose` (with `--wiki` if the flag was passed at `--init` time), staging pages under `.wiki/`
4. Probes the wiki remote (`<repo>.wiki.git`) with `git ls-remote` to detect whether the wiki has been initialized
5. If there are content changes and the wiki is initialized: clones `<repo>.wiki.git`, syncs the staged `.wiki/` content (excluding `config.json` and the run metadata) via `rsync`, commits, and **pushes directly to `master`** — the wiki goes live immediately (no PR, no review gate)
6. Always opens a `docs: wiki staging snapshot` pull request against the main repo with the `.wiki/` changes, so the staged content stays auditable

### Bootstrap the wiki first

GitHub wikis must be initialized once through the UI before they can be pushed to programmatically. Open the **Wiki** tab in your repository, create the first page (any content), then run the workflow. Until then the publish step is skipped with a warning; the staging PR still opens so you can inspect the generated content.

The full workflow is written to `.github/workflows/update-wiki.yml` by `wiki --init`. See that file (or the template in [`src/agent.ts`](src/agent.ts) `createWorkflowFile`) for the authoritative, current definition.

### Required secrets

| Secret | Required | Description |
|--------|----------|-------------|
| `WIKI_OLLAMA_API_KEY` | Yes | Ollama Cloud API key |
| `APP_CLIENT_ID` | No | GitHub App client ID for token generation (falls back to `GITHUB_TOKEN`) |
| `APP_PRIVATE_KEY` | No | GitHub App private key |
| `WIKI_PUSH_TOKEN` | No | PAT with `repo` scope used to push to the wiki repo. If unset, the GitHub App token or `GITHUB_TOKEN` is used. Set this only if the default token cannot push to the wiki repo. |

### Optional variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WIKI_MODEL` | `kimi-k2.7-code` | Model ID override |

## Output

Each run produces:

```
.wiki/
├── .last-updated.json        # ISO timestamp of last run
├── .last-update-report.md    # Change report (created/edited pages)
├── config.json               # Project-specific config
├── quickstart.md             # Entry point
├── architecture/
│   ├── index.md              # Auto-generated directory index
│   └── overview.md
├── cli/
│   ├── index.md
│   └── usage.md
└── index.md                  # Root directory index
```

- `.last-updated.json` — `{ "lastUpdated": "2026-07-17T10:30:00.000Z" }`
- `.last-update-report.md` — markdown report listing created and edited pages, used as the staging PR body in CI
- `index.md` files — auto-generated for each directory, listing pages and subdirectories with frontmatter titles/descriptions

## Development

```bash
bun install
npx tsc -p tsconfig.json
npx vitest run
bun pm pack
```

## How it works

1. The agent reads `AGENTS.md` or `CLAUDE.md` from the project root and follows all conventions documented there
2. It inspects your source code using a restricted, read-only toolset: `read_file`, `ls`, `glob`, `grep`, `ast_grep`, `ast_search`, and a read-only `git` tool (whitelisted subcommands only — no mutating git, no shell)
3. It generates wiki pages under `.wiki/` with YAML frontmatter using `write_file` and `edit_file` (the only mutating tools, constrained to `.wiki/`)
4. After the run, `index.md` files are synchronized for each directory
5. `.last-updated.json` and `.last-update-report.md` are written
6. On `--init`, a GitHub Actions workflow is created for scheduled updates
7. In update mode, only pages affected by recent changes are refreshed
8. With `--wiki`, the workflow also publishes to the GitHub Wiki tab by pushing directly to `<repo>.wiki.git` `master`

The agent uses a manual tool-calling loop with the Ollama chat API — no LangChain or LangGraph dependency. The recursion limit prevents infinite loops. There is no general-purpose shell tool; the agent cannot execute arbitrary commands on the host system.