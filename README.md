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
- **Change reports** — each run writes `.wiki/.last-update-report.md` with created/edited pages, used as the PR body in CI
- **Self-invocation guard** — the agent cannot recursively invoke `wiki` or `wiki-agent` via shell commands

## Quickstart

### 1. Install

Build from source and install globally with bun:

```bash
git clone https://github.com/nx-solutions-ug/wiki-agent.git
cd wiki-agent
npm install
npx tsc -p tsconfig.json
bun pm pack
cd ~/.bun/install/global && bun add /path/to/wiki-agent/wiki-agent-0.1.0.tgz
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

Running `wiki --init` automatically creates `.github/workflows/update-wiki.yml` in your repo. The workflow:

1. Generates a GitHub App token if `CLIENT_ID` and `APP_PRIVATE_KEY` secrets are set (falls back to `GITHUB_TOKEN`)
2. Checks out your repo
3. Clones and builds wiki-agent from `nx-solutions-ug/wiki-agent`
4. Runs `wiki --update --print` with your Ollama Cloud credentials
5. Reads `.wiki/.last-update-report.md` and uses it as the PR body
6. Creates a pull request with the `.wiki/` changes

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
      - name: Generate token
        id: token
        uses: actions/create-github-app-token@v3
        with:
          client-id: ${{ secrets.CLIENT_ID }}
          private-key: ${{ secrets.APP_PRIVATE_KEY }}
        continue-on-error: true

      - uses: actions/checkout@v7
        with:
          token: ${{ steps.token.outputs.token || secrets.GITHUB_TOKEN }}

      - uses: actions/setup-node@v7
        with:
          node-version: "25"

      - name: Build Wiki Agent
        run: |
          git clone --branch main --depth 1 https://github.com/nx-solutions-ug/wiki-agent.git /tmp/wiki-agent
          cd /tmp/wiki-agent
          npm install
          npx tsc -p tsconfig.json

      - name: Run Wiki Agent
        run: node /tmp/wiki-agent/dist/cli.js --update --print
        env:
          WIKI_OLLAMA_MODE: cloud
          WIKI_OLLAMA_API_KEY: ${{ secrets.WIKI_OLLAMA_API_KEY }}
          WIKI_MODEL: ${{ vars.WIKI_MODEL || 'kimi-k2.7-code' }}

      - name: Generate timestamp
        id: timestamp
        run: echo "timestamp=$(date +%s)" >> $GITHUB_OUTPUT

      - name: Read update report
        id: report
        run: |
          if [ -f .wiki/.last-update-report.md ]; then
            echo "body<<EOF" >> $GITHUB_OUTPUT
            cat .wiki/.last-update-report.md >> $GITHUB_OUTPUT
            echo "EOF" >> $GITHUB_OUTPUT
          else
            echo "body=Automated wiki documentation update." >> $GITHUB_OUTPUT
          fi

      - uses: peter-evans/create-pull-request@v8
        with:
          token: ${{ steps.token.outputs.token || secrets.GITHUB_TOKEN }}
          add-paths: .wiki
          branch: wiki/update-${{ steps.timestamp.outputs.timestamp }}
          commit-message: "docs: update wiki"
          title: "docs: update wiki"
          body: ${{ steps.report.outputs.body }}
```

### Required secrets

| Secret | Required | Description |
|--------|----------|-------------|
| `WIKI_OLLAMA_API_KEY` | Yes | Ollama Cloud API key |
| `CLIENT_ID` | No | GitHub App client ID for token generation (falls back to `GITHUB_TOKEN`) |
| `APP_PRIVATE_KEY` | No | GitHub App private key |

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
- `.last-update-report.md` — markdown report listing created and edited pages, used as the PR body in CI
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
2. It inspects your source code using filesystem tools (read, grep, glob, execute)
3. It generates wiki pages under `.wiki/` with YAML frontmatter
4. After the run, `index.md` files are synchronized for each directory
5. `.last-updated.json` and `.last-update-report.md` are written
6. On `--init`, a GitHub Actions workflow is created for scheduled updates
7. In update mode, only pages affected by recent changes are refreshed

The agent uses a manual tool-calling loop with the Ollama chat API — no LangChain or LangGraph dependency. The recursion limit prevents infinite loops. The `execute` tool blocks self-invocation to prevent recursive runs.