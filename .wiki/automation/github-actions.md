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

1. Optionally generates a GitHub App token with `actions/create-github-app-token@v2` if `APP_ID` and `APP_PRIVATE_KEY` secrets are present. This step uses `continue-on-error: true`, so it falls back to `secrets.GITHUB_TOKEN` when the app secrets are absent.
2. Checks out the repository with `actions/checkout@v7` and the generated or default token.
3. Sets up Node.js 22 with `actions/setup-node@v7`.
4. Clones `https://github.com/nx-solutions-ug/wiki-agent.git` to `/tmp/wiki-agent`, installs dependencies, and compiles with `npx tsc -p tsconfig.json`.
5. Runs `node /tmp/wiki-agent/dist/cli.js --update --print` in headless mode with `WIKI_OLLAMA_MODE=cloud`.
6. Generates a timestamp for the branch name.
7. Checks for `.wiki/.last-update-report.md`. If the file exists, it sets `has_changes=true` and loads the report contents into a multiline output; otherwise it sets `has_changes=false`.
8. Opens a pull request via `peter-evans/create-pull-request@v8`, but only when `has_changes == 'true'`. The PR adds the `.wiki` path on a unique `wiki/update-<timestamp>` branch and uses the report as the PR body.

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
| `APP_ID` | Secret (optional) | GitHub App ID for token generation; falls back to `secrets.GITHUB_TOKEN`. |
| `APP_PRIVATE_KEY` | Secret (optional) | GitHub App private key for token generation. |
| `WIKI_MODEL` | Variable (optional) | Model ID override. Defaults to `kimi-k2.7-code` if unset. |

The `WIKI_OLLAMA_BASE_URL` environment variable is not set; the agent uses the cloud default `https://ollama.com`. Override it by adding a step that exports the variable if you need a self-hosted endpoint.

## Output

When the agent edits one or more wiki pages, it writes `.wiki/.last-update-report.md` and the workflow uses that report as the pull-request body. The PR only includes files under `.wiki/` (via `add-paths: .wiki`), so source code is never touched by the bot.

If the agent makes no content changes, `.wiki/.last-update-report.md` is not written, `has_changes` remains `false`, and the `create-pull-request` step is skipped entirely. In that case the workflow run produces no pull request.

## Local dry run

You can reproduce the same event stream locally without opening a PR:

```bash
WIKI_OLLAMA_MODE=cloud \
WIKI_OLLAMA_API_KEY="$WIKI_OLLAMA_API_KEY" \
WIKI_MODEL=kimi-k2.7-code \
wiki --update --print
```

If the wiki is already current, the agent emits a `done` event with "Wiki is already current. No files changed." and skips both the index synchronizer and the report file. See [Architecture](./../architecture/overview.md) for how that is detected.
