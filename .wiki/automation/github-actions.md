---
type: Reference
title: GitHub Actions
description: Scheduled and on-demand wiki updates using the bundled workflow and headless mode.
tags: [github-actions, ci, automation, cron]
---

# GitHub Actions

Running `wiki --init` writes `.github/workflows/update-wiki.yml` (via `src/agent.ts:createWorkflowFile`). The workflow runs the agent on a cron schedule and opens a pull request with the changes. It can also be triggered manually via `workflow_dispatch`.

## What the workflow does

The workflow:

1. Optionally generates a GitHub App token with `actions/create-github-app-token@v3` if `APP_CLIENT_ID` and `APP_PRIVATE_KEY` secrets are present; otherwise it falls back to `secrets.GITHUB_TOKEN`.
2. Checks out the repository with `actions/checkout@v7`.
3. Sets up Node.js 25 with `actions/setup-node@v7`.
4. Clones `https://github.com/nx-solutions-ug/wiki-agent.git` to `/tmp/wiki-agent`, installs dependencies, and compiles with `npx tsc -p tsconfig.json`.
5. Runs `node /tmp/wiki-agent/dist/cli.js --update --print --verbose` in headless mode with `WIKI_OLLAMA_MODE=cloud`.
   After the run the agent also updates `.wiki/.last-updated.json` and writes `.wiki/.last-update-report.md` (when there are changes).
6. Checks whether `.wiki/.last-update-report.md` exists.
   - If it exists, it sets `has_changes=true` and streams the report into a `body<<EOF` heredoc on `$GITHUB_OUTPUT`, adding an empty `echo ""` before the `EOF` delimiter so the delimiter sits on its own line.
   - If the report is missing, it sets `has_changes=false` and no pull request is opened.
7. Opens a pull request via `peter-evans/create-pull-request@v8` (only when `steps.report.outputs.has_changes == 'true'`) that adds the `.wiki` path on a unique `wiki/update-<timestamp>` branch.

Permissions are explicitly granted for `contents: write` and `pull-requests: write`, both of which are required for the create-pull-request step.

## Triggering

The default triggers are:

- `workflow_dispatch` — manual run from the Actions tab.
- `push` to the `main` branch.
- `schedule: cron: "0 8 * * *"` — daily at 08:00 UTC.

Adjust the cron expression to taste; remember that GitHub Actions cron is UTC.

## Secrets and variables

| Name | Type | Purpose |
|------|------|---------|
| `WIKI_OLLAMA_API_KEY` | Secret | Bearer token for Ollama Cloud. Required because the workflow forces cloud mode. |
| `APP_CLIENT_ID` | Secret (optional) | GitHub App client ID for token generation; falls back to `secrets.GITHUB_TOKEN`. |
| `APP_PRIVATE_KEY` | Secret (optional) | GitHub App private key for token generation. |
| `WIKI_MODEL` | Variable (optional) | Model ID override. Defaults to `kimi-k2.7-code` if unset. |

The `WIKI_OLLAMA_BASE_URL` environment variable is not set; the agent uses the cloud default `https://ollama.com`. Override it by adding a step that exports the variable if you need a self-hosted endpoint.

## Output

The pull request body is read from `.wiki/.last-update-report.md` after the run, so it reflects the pages that were actually changed. Because `generateUpdateReport` appends a trailing newline, the heredoc written to `$GITHUB_OUTPUT` is terminated correctly and GitHub Actions can parse it. If the report is missing it falls back to a static message. The PR only includes files under `.wiki/` (via `add-paths: .wiki`), so source code is never touched by the bot.

## Local dry run

You can reproduce the same event stream locally without opening a PR:

```bash
WIKI_OLLAMA_MODE=cloud \
WIKI_OLLAMA_API_KEY="$WIKI_OLLAMA_API_KEY" \
WIKI_MODEL=kimi-k2.7-code \
wiki --update --print --verbose
```

If the wiki is already current, the agent emits no edits and the index synchronizer leaves `index.md` files untouched. See [Architecture](./../architecture/overview.md) for how that is detected.
