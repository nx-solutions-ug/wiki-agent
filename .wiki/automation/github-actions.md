---
type: Reference
title: GitHub Actions
description: Scheduled and on-demand wiki updates using the bundled workflow and headless mode.
tags: [github-actions, ci, automation, cron]
---

# GitHub Actions

Running `wiki --init` writes `.github/workflows/update-wiki.yml` (via `src/agent.ts:createWorkflowFile`). The workflow runs the agent on a cron schedule. When the `--wiki` flag is passed, the workflow also publishes the generated pages to the repository's **GitHub Wiki tab** (via the separate `<repo>.wiki.git` Git remote), pushing directly to `master`. Without `--wiki`, the workflow only stages `.wiki/` and opens a staging PR. It can also be triggered manually via `workflow_dispatch`.

## What the workflow does

The workflow:

1. Optionally generates a GitHub App token with `actions/create-github-app-token@v3` if `APP_CLIENT_ID` and `APP_PRIVATE_KEY` secrets are present; otherwise it falls back to `secrets.GITHUB_TOKEN`.
2. Checks out the repository with `actions/checkout@v7`.
3. Sets up Bun with `oven-sh/setup-bun@v2`.
4. Sets up Node.js 25 with `actions/setup-node@v7`. Node is required by the bundled `wiki-flatten` binary (`#!/usr/bin/env node`), even though the agent itself runs via Bun.
5. Installs the published package with `bun add -g @chronova/wiki-agent`.
6. Runs `wiki --update --print --verbose` (with `--wiki` if the flag was passed at `--init` time) in headless mode with `WIKI_OLLAMA_MODE=cloud`. The `--verbose` flag makes tool call results appear in the CI log alongside assistant prose.
   `GH_TOKEN` is exported as `${{ steps.token.outputs.token || secrets.GITHUB_TOKEN }}` so the agent's read-only `gh` CLI tool can authenticate in CI (for example, when checking open staging PRs).
   After the run the agent also updates `.wiki/.last-updated.json` and writes `.wiki/.last-update-report.md` (when there are changes).
7. Emits repository coordinates (`GITHUB_REPOSITORY` → `owner/repo`) and a timestamp into step outputs.
8. Checks for content changes under `.wiki/` using `git status --porcelain .wiki`, stripping the status prefix and excluding the run metadata files `.wiki/.last-update-report.md` and `.wiki/.last-updated.json`. If real content files changed, sets `has_changes=true` and streams the report into a `body<<EOF` heredoc on `$GITHUB_OUTPUT` (with an empty `echo ""` before `EOF` so the delimiter sits on its own line).
9. **Flatten the wiki for GitHub** (only when the workflow was created with `--wiki`):
   - `wiki-flatten "$GITHUB_WORKSPACE/.wiki" /tmp/wiki-flat` converts the nested `.wiki/` tree into the flat format GitHub Wikis require.
   - Nested pages become dash-joined names (`architecture/overview.md` → `Architecture-Overview.md`, `cli/usage.md` → `CLI-Usage.md`); root `index.md` becomes `Home.md`; section index files become the section name (`architecture/index.md` → `Architecture.md`).
   - Internal relative links like `[Text](./cli/usage.md)` are rewritten to `[Text](CLI-Usage)`.
   - A `_Sidebar.md` is generated from the page frontmatter.
   - Metadata files (`.git`, `config.json`, `.last-update-report.md`, `.last-updated.json`) are excluded.
10. **Publish to wiki repo** (only when `has_changes=true` and `initialized=true`, and only when the workflow was created with `--wiki`): clones `<repo>.wiki.git` into `/tmp/wiki`, `rsync`s the flattened `/tmp/wiki-flat/` output over the clone excluding `.git`, commits, and **pushes directly to `master`** — the wiki goes live immediately with no PR or review gate. GitHub wiki repos are hidden Git remotes, not API-accessible repositories, so `gh pr create` cannot open a PR against them; direct push to `master` is the only programmatic publish path. If the push fails with 401/403, emits a `::error::` explaining that either the GitHub App needs `contents:write` (which covers the wiki repo) or a `WIKI_PUSH_TOKEN` secret must be set, then exits 1.
11. **Create wiki staging snapshot pull request** (always when `has_changes=true`): `peter-evans/create-pull-request@v8` adds `.wiki/` on a `wiki/staging-<timestamp>` branch of the main repo and opens a `docs: wiki staging snapshot` PR. This keeps the staged content auditable in the main repo even though the live surface is the wiki tab.

Permissions are explicitly granted for `contents: write` and `pull-requests: write`. `contents: write` is required both for the wiki repo clone/push (the wiki repo shares the parent's installation) and for the staging PR. `pull-requests: write` is required to open the staging PR.

## Triggering

The default triggers are:

- `workflow_dispatch` — manual run from the Actions tab.
- `push` to the `main` branch.
- `schedule: cron: "0 8 * * *"` — daily at 08:00 UTC.

Adjust the cron expression to taste; remember that GitHub Actions cron is UTC.

## Bootstrap the wiki first

GitHub wikis must be initialized once through the UI before they can be pushed to programmatically. There is no API to initialize a wiki. Open the **Wiki** tab in your repository, create the first page (any content), then run the workflow. The `Detect wiki initialization` step probes the wiki remote with `git ls-remote --exit-code`; if it returns non-zero, the publish step is skipped with a `::warning::` and the staging PR still opens so you can inspect the generated content.

## Release pipeline

The same commit that refreshes this wiki can also run the release pipeline. `.github/workflows/release.yml` (added in commit `74f5621`) runs on every push to `main` and, after a passing test job, executes `semantic-release` to bump the version, write `CHANGELOG.md`, create a GitHub release, and publish `@chronova/wiki-agent` to npm. The release job generates a GitHub App token with `actions/create-github-app-token@v3` using `secrets.APP_CLIENT_ID` and `secrets.APP_PRIVATE_KEY`; it does not fall back to `secrets.GITHUB_TOKEN`. The `WIKI_OLLAMA_API_KEY` secret used by the wiki update job is unrelated to the `NPM_TOKEN` secret used by the release job. This is distinct from the wiki publish step above, which pushes to `<repo>.wiki.git`.

## Secrets and variables

| Name | Type | Purpose |
|------|------|---------|
| `WIKI_OLLAMA_API_KEY` | Secret | Bearer token for Ollama Cloud. Required because the workflow forces cloud mode. |
| `APP_CLIENT_ID` | Secret (optional) | GitHub App client ID for token generation; falls back to `secrets.GITHUB_TOKEN`. |
| `APP_PRIVATE_KEY` | Secret (optional) | GitHub App private key for token generation. |
| `WIKI_MODEL` | Variable (optional) | Model ID override. Defaults to `kimi-k2.7-code` if unset. |
| `WIKI_PUSH_TOKEN` | Secret (optional) | PAT with `repo` scope used to push to the wiki repo and open the wiki PR. If unset, the GitHub App token or `GITHUB_TOKEN` is used. Set only if the default token cannot push to the wiki repo. |
| `GH_TOKEN` | Env (injected) | Not a repo secret; derived from `${{ steps.token.outputs.token || secrets.GITHUB_TOKEN }}` and passed as the `GH_TOKEN` environment variable so the `gh` CLI calls inside the agent can read PR state. |

The `WIKI_OLLAMA_BASE_URL` environment variable is not set; the agent uses the cloud default `https://ollama.com`. Override it by adding a step that exports the variable if you need a self-hosted endpoint.

## Output
The staging PR body is read from `.wiki/.last-update-report.md` after the run, so it reflects the pages that were actually changed and includes a per-file description of what changed and why. Because `generateUpdateReport` appends a trailing newline, the heredoc written to `$GITHUB_OUTPUT` is terminated correctly and GitHub Actions can parse it. The staging PR only includes files under `.wiki/` (via `add-paths: .wiki`), so source code is never touched. The publish to the wiki tab excludes metadata files (`config.json`, `.last-update-report.md`, `.last-updated.json`) via the flatten step, so only content pages reach the live wiki.

## Updating the workflow template
The file written by `--init` is generated from `src/agent.ts:createWorkflowFile`. Recent fixes synced the template with the live workflow: it now installs the published package via Bun, includes `actions/setup-node@v7` for `wiki-flatten`, and exports `GH_TOKEN` for the agent's `gh` CLI calls. If you edit `.github/workflows/update-wiki.yml` by hand, remember that `--init` will overwrite it if you run it again.

## Skipping metadata-only runs

The workflow deliberately skips opening either PR when the only files that changed are `.wiki/.last-update-report.md` and `.wiki/.last-updated.json`. Those files are rewritten on every agent run, so without the filter the bot would open empty pull requests every day. The `git status --porcelain .wiki` filter catches both tracked and untracked changes, then strips the two metadata paths before deciding whether to publish. Additionally, if the wiki push produces no net content changes after the `rsync` (e.g. the wiki already matches), the publish step logs a `::warning::` and skips the wiki PR while the staging PR still opens.

## Local dry run

You can reproduce the same event stream locally without opening a PR:

```bash
WIKI_OLLAMA_MODE=cloud \
WIKI_OLLAMA_API_KEY="$WIKI_OLLAMA_API_KEY" \
WIKI_MODEL=kimi-k2.7-code \
wiki --update --print --verbose
```

If the wiki is already current, the agent emits no edits and the index synchronizer leaves `index.md` files untouched. See [Architecture](./../architecture/overview.md) for how that is detected.
