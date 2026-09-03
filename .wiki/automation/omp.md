---
type: Reference
title: OMP Automation Workflows
description: GitHub Actions workflows that run OMP for issue triage, PR
  labeling, PR review, and on-demand chat commands.
tags: [ github-actions, ci, automation, omp ]
last_updated: 2026-09-03T14:08:26.639Z
updated_by: wiki-agent
---

# OMP Automation Workflows

In addition to the [Wiki update workflow](github-actions.md), the repository runs a set of GitHub Actions workflows that invoke **OMP** (`omp.sh`) for automated issue/PR management and on-demand chat-driven commands. These workflows are distinct from wiki-agent itself — they are part of the project's own CI automation.

## Workflows

### `.github/workflows/auto-manage.yml`

Lightweight repository hygiene automation:

- Adds the `needs-triage` label to newly opened or reopened issues.
- Auto-assigns new issues and PRs to `niklasschaeffer`.

Both jobs generate a GitHub App token with `actions/create-github-app-token@v3` and run `gh` commands against the repository.

### `.github/workflows/omp.yml`

On-demand OMP invocation triggered by comments:

- Fires on `issue_comment` and `pull_request_review_comment` events, but only when the comment body starts with `/omp` or contains ` /omp` (also accepts `/oc`).
- Generates a GitHub App token, authenticates `gh`, installs the `gh-pr-review` extension (`agynio/gh-pr-review`) pinned to `v1.6.2`, and sets up git push credentials. This extension is required by the PR review prompt even though this workflow also serves issue comments.
- Installs OMP and authenticates it against Ollama Cloud using `secrets.OLLAMA_API_KEY`.
- Extracts the command name and arguments from the comment. If the comment matches a `.omp/commands/<command>.md` file, that prompt is expanded by replacing `$ARGUMENTS`. For freeform prompts that do not match a command file, the raw prompt is written; and for PR comments (but not issue comments), `.omp/commands/_pr-commit-push.md` is appended after substituting `__PR_NUMBER__` so the agent checks out the PR branch and commits/pushes any changes.
- Runs OMP in JSON mode with `--model ollama-cloud/glm-5.3-flash:max`, which matches the `default`/`task`/`commit` roles in `.omp/agent/config.yml`; the workflow does not consume the role mapping directly.

### `.github/workflows/omp-ci.yml`

Automated OMP jobs triggered by repository events:

- **`triage-issue`** — runs when an issue is opened or when manually dispatched with an issue number. Reacts with 👀, installs OMP, authenticates to Ollama Cloud, expands `.omp/commands/triage-issue.md`, runs OMP, and dispatches a follow-up `issue-triaged` event.
- **`label-pr`** — runs when a PR is opened or marked ready for review. Skips if the PR already has both a type label (`bug`, `feature`, `enhancement`, `docs`, `chore`) and a priority label (`priority: critical`, `priority: high`, `priority: medium`, `priority: low`). Otherwise, expands `.omp/commands/label-pr.md` and runs OMP.
- **`cancel-label-on-close`** — runs when a PR is closed. Cancels any in-progress `omp-ci` workflow runs for that PR to avoid wasting compute on stale labeling jobs.

After each triage run, `omp-ci.yml` dispatches `.github/workflows/omp-fix-issue.yml` with the issue number in `client_payload`.

### `.github/workflows/omp-code-review.yml`

Dedicated PR code review workflow, split from `omp-ci.yml` in commit `9102bab`. Triggered by PR open/update/ready_for_review/review_requested, PR review submission, PR review comment, or manual dispatch. Concurrency group per-PR (`omp-code-review-<pr>`) cancels in-progress runs on new pushes.

- **`dependency-review`** — runs only for PRs authored by `renovate[bot]` or `dependabot[bot]`. Expands `.omp/commands/dependency-review.md` (researches changelogs, assesses breaking changes) and verifies a review or comment was actually posted.
- **`code-review`** — runs for human-authored PRs and `workflow_dispatch`. Skips agent-authored re-reviews on `synchronize` (checks head commit author/committer for `opencode-agent`, `opencode`, `github-actions`, `omp-agent`, `chronova-agent`), but honors explicit `review_requested` re-triggers. Detects Jules involvement (Jules-authored PR, Jules review, or Jules review comment) and passes context to `.omp/commands/review-pr.md`. Verifies at least one review or comment exists; skips verification when the PR modifies the review workflow itself.

Both jobs install the `gh-pr-review` extension pinned to `v1.6.2`, post an `eyes` reaction, and run OMP with `--model ollama-cloud/glm-5.3-flash:max`.

## Command prompts

The `.omp/commands/*.md` files contain parameterized prompts used by the OMP workflows:

- `.omp/commands/triage-issue.md` — triage instructions for new issues.
- `.omp/commands/label-pr.md` — instructions for assigning type and priority labels.
- `.omp/commands/review-pr.md` — instructions for reviewing pull requests.
- `.omp/commands/dependency-review.md` — instructions for reviewing dependency-bot PRs (changelog research, breaking-change assessment).
- `.omp/commands/fix-issue.md` — instructions for generating fixes from triaged issues.
- `.omp/commands/_pr-commit-push.md` — commit/push instructions appended to freeform `/omp` prompts on PR comments so the agent persists changes to the PR branch.

These prompts reference `$ARGUMENTS`, which the workflow replaces with the issue or PR number at runtime. The `.omp/rules/` directory contains shared guard rules that OMP applies when running the expanded prompts. Example rules include `gh-label-idempotent.md` and `tool-paths-must-be-arrays.md`.

## OMP stream log

`.omp/stream-log.py` is a Python formatter that consumes OMP JSONL output and prints human-readable CI log lines. It is invoked as `python3 .omp/stream-log.py` after every `omp -p --mode json` run. The script defensively coerces non-string `text` and non-dict `args` values so malformed upstream events do not break the pipe; `test/stream-log.test.ts` covers these regressions from issue #76.

## Secrets used by OMP workflows

| Secret | Purpose |
|--------|---------|
| `APP_CLIENT_ID` | GitHub App client ID for token generation |
| `APP_PRIVATE_KEY` | GitHub App private key for token generation |
| `OLLAMA_API_KEY` | Ollama Cloud API key used by OMP to access `ollama-cloud/glm-5.3-flash:max` |
| `GH_TOKEN` | GitHub token for `gh` commands (the OMP workflows authenticate `gh` with the generated GitHub App token) |

These are separate from the `WIKI_OLLAMA_API_KEY` secret used by the wiki update workflow.
