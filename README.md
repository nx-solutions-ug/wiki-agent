# Wiki Agent

A standalone Ollama-only documentation agent. It inspects your source code and generates a wiki under `.wiki/` in your project root.

## Features

- **Ollama-only** — uses the native `ollama` SDK, no LangChain dependency
- **Local or Cloud** — connect to a local Ollama server or Ollama Cloud with an API key
- **TUI + Headless** — interactive terminal UI or `--print` for CI/CD
- **Two commands** — `--init` to create docs from scratch, `--update` to refresh existing docs
- **Configurable** — global config in `~/.wiki/`, project config in `.wiki/`
- **GitHub Actions** — `--init` automatically creates a scheduled update workflow in your repo
- **Repo instructions** — reads `AGENTS.md` or `CLAUDE.md` from the project root and follows all conventions documented there

## Quickstart

### 1. Install

```bash
npm install --global wiki-agent
```

Or with bun:

```bash
cd ~/.bun/install/global && bun add /path/to/wiki-agent-0.1.0.tgz
```

### 2. Configure

Run interactively once to set up credentials:

```bash
cd your-project
wiki --init
```

This launches the TUI where you select Ollama Local or Cloud and enter your API key (if cloud).

### 3. Use

```bash
# Initialize documentation (also creates .github/workflows/update-wiki.yml)
wiki --init

# Update existing documentation
wiki --update

# Headless mode (for CI)
wiki --update --print

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

Running `wiki --init` automatically creates `.github/workflows/update-wiki.yml` in your repo with this workflow:

```yaml
name: Wiki Update
on:
  workflow_dispatch:
  push:
    branches:
      - main
  schedule:
    - cron: "0 8 * * *"
permissions:
  contents: write
  pull-requests: write
jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: "22"
      - name: Build Wiki Agent
        run: |
          git clone --branch main --depth 1 https://github.com/nx-solutions-ug/wiki-agent.git /tmp/wiki-agent
          cd /tmp/wiki-agent
          npm install
          npx tsc -p tsconfig.json
      - run: node /tmp/wiki-agent/dist/cli.js --update --print
        env:
          WIKI_OLLAMA_MODE: cloud
          WIKI_OLLAMA_API_KEY: ${{ secrets.WIKI_OLLAMA_API_KEY }}
          WIKI_MODEL: ${{ vars.WIKI_MODEL || 'kimi-k2.7-code' }}
      - uses: peter-evans/create-pull-request@v8
        with:
          add-paths: .wiki
          branch: wiki/update
          commit-message: "docs: update wiki"
          title: "docs: update wiki"
          body: "Automated wiki documentation update."
```

Set `WIKI_OLLAMA_API_KEY` in your repo secrets and optionally `WIKI_MODEL` in your repo variables.

## Development

```bash
bun install
npx tsc -p tsconfig.json
npx vitest run
bun pm pack
```

## How it works

1. The agent reads `AGENTS.md` or `CLAUDE.md` from the project root and follows all conventions documented there
2. It inspects your source code using filesystem tools (read, grep, glob, execute)
3. It generates wiki pages under `.wiki/` with YAML frontmatter
4. After the run, `index.md` files are synchronized for each directory
5. On `--init`, a GitHub Actions workflow is created for scheduled updates
6. In update mode, only pages affected by recent changes are refreshed

The agent uses a manual tool-calling loop with the Ollama chat API — no LangChain or LangGraph dependency. The recursion limit prevents infinite loops.