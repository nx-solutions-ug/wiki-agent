---
type: Reference
title: OMP Automation Workflows
description: GitHub Actions workflows that run OMP for issue triage, PR labeling, PR review, and on-demand chat commands.
tags: [github-actions, ci, automation, omp]
---

# OMP Automation Workflows

In addition to the [Wiki update workflow](github-actions.md), the repository runs a set of GitHub Actions workflows that invoke **OMP** (`omp.sh`) for automated issue/PR management and on-demand chat-driven commands. These workflows are distinct from wiki-agent itself — they are part of the project's own CI automation.

## Stream logging

The OMP workflows pipe JSONL output from `omp -p --mode json ...` through `.omp/stream-log.py` to produce human-readable CI log lines. The script handles the full OMP event stream (`agent_start`, `turn_start`, `tool_execution_start`, `tool_execution_end`, `message_end`, `agent_end`) and is intentionally defensive:

- `_as_str()` coerces non-string `text` values — `None`, ints, lists, dicts — into strings before they are concatenated, so malformed tool results never raise `TypeError` and break the pipe.
- `_path_from_args()` extracts a display path from read/write/edit tool events even when `args` is not a dict or nests the path under an `input` sub-object, falling back to `brief_args()` for unknown shapes.
- `brief_args()` tolerates non-dict inputs for all other tools.
- Malformed JSON lines are skipped without aborting the stream.

These guards were added to fix the crash reported in issue #76, where non-dict `args` or non-string `text` content terminated the formatter with a non-zero exit code and broke the upstream `omp` pipe.

## Workflows

### `.github/workflows/auto-manage.yml`

Lightweight repository hygiene automation:

- Adds the `needs-triage` label to newly opened or reopened issues.
- Auto-assigns new issues and PRs to `niklasschaeffer`.

Both jobs generate a GitHub App token with `actions/create-github-app-token@v3` and run `gh` commands against the repository.

### `.github/workflows/omp.yml`

On-demand OMP invocation triggered by comments:

- Fires on `issue_comment` and `pull_request_review_comment` events, but only when the comment body starts with `/omp` or contains ` /omp` (also accepts `/oc`).
- Generates a GitHub App token, authenticates `gh`, and sets up git push credentials.
- Installs OMP and authenticates it against Ollama Cloud using `secrets.OLLAMA_API_KEY`.
- Extracts the command name and arguments from the comment, expands any matching `.omp/commands/<command>.md` prompt by replacing `$ARGUMENTS`, and pipes the result through `python3 .omp/stream-log.py`.
- Runs OMP in JSON mode with model `ollama-cloud/minimax-m3` (per `.omp/agent/config.yml`, which maps `default`, `task`, and `commit` roles to `ollama-cloud/minimax-m3`).

### `.github/workflows/omp-ci.yml`

Automated OMP jobs triggered by repository events:

- **`triage-issue`** — runs when an issue is opened or when manually dispatched with an issue number. Reacts with 👀, installs OMP, authenticates to Ollama Cloud, expands `.omp/commands/triage-issue.md`, runs OMP, and dispatches a follow-up `issue-triaged` event.
- **`label-pr`** — runs when a PR is opened, synchronized, or marked ready for review. Skips if the PR already has both a type label (`bug`, `feature`, `enhancement`, `docs`, `chore`) and a priority label (`priority: critical`, `priority: high`, `priority: medium`, `priority: low`). Otherwise, expands `.omp/commands/label-pr.md` and runs OMP.
- **`review-pr`** — runs on PR open/update or manual dispatch. On `synchronize`, it first checks whether the head commit author/committer looks like an agent/bot (names containing `opencode-agent`, `opencode`, `github-actions`, `omp-agent`, or `chronova-agent`). If the commit is from such an author, the re-review is skipped. It then classifies the PR as dependency / bot / human based on the PR author (`renovate`, `dependabot`, `[bot]`, or `opencode-agent` get special prefixes), posts an `eyes` reaction, and expands `.omp/commands/review-pr.md` for OMP review.

## Command prompts

The `.omp/commands/*.md` files contain parameterized prompts used by the OMP workflows:

- `.omp/commands/triage-issue.md` — triage instructions for new issues.
- `.omp/commands/label-pr.md` — instructions for assigning type and priority labels.
- `.omp/commands/review-pr.md` — instructions for reviewing pull requests.
- `.omp/commands/fix-issue.md` — instructions for generating fixes from triaged issues.

These prompts reference `$ARGUMENTS`, which the workflow replaces with the issue or PR number at runtime. The `.omp/rules/` directory contains shared guard rules that OMP applies when running the expanded prompts.

## Secrets used by OMP workflows

| Secret | Purpose |
|--------|---------|
| `APP_CLIENT_ID` | GitHub App client ID for token generation |
| `APP_PRIVATE_KEY` | GitHub App private key for token generation |
| `OLLAMA_API_KEY` | Ollama Cloud API key used by OMP to access `ollama-cloud/minimax-m3` |
| `GH_TOKEN` | GitHub token for `gh` commands (the OMP workflows authenticate `gh` with the generated GitHub App token) |

These are separate from the `WIKI_OLLAMA_API_KEY` secret used by the wiki update workflow.
