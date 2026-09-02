---
type: Reference
title: Vouch Access Control
description: Discussion-driven vouching for maintainers and the PR gate that enforces it.
tags: [ github-actions, ci, automation, vouch, access-control ]
last_updated: 2026-08-31T17:07:26.169Z
updated_by: wiki-agent
---

# Vouch Access Control

The repository uses the [mitchellh/vouch](https://github.com/mitchellh/vouch) GitHub Action to gate pull requests from external contributors. Maintainers manage the vouch list by commenting on Discussions, and a separate workflow automatically closes PRs from unvouched users.

## Vouched users list

The canonical list is stored in `.github/VOUCHED.td`:

- One GitHub handle per line, without the leading `@`.
- Lines are sorted alphabetically.
- To denounce a user, prefix the handle with `-`.
- Optional details can follow the handle after a space.
- The file header explains how to request a vouch and documents the syntax.

Bots (handles ending with `[bot]`) and collaborators with `admin`, `maintain`, or `write` access are automatically allowed, regardless of the list.

## Managing vouches via Discussions

`.github/workflows/vouch-manage.yml` runs on `discussion_comment` events when a maintainer comments on a Discussion. Only collaborators with `admin`, `maintain`, or `write` roles are honored.

Supported commands in the comment body:

| Command | Effect |
|---------|--------|
| `!vouch` | Vouch the discussion author. |
| `!vouch @user [reason]` | Vouch a specific user. |
| `!denounce [@user] [reason]` | Denounce the discussion author or a specific user. |
| `!unvouch [@user]` | Remove the vouch for the discussion author or a specific user. |

The workflow checks out the repository with `actions/checkout@v7` and delegates to `mitchellh/vouch/action/manage-by-discussion@v1`, passing the discussion number, comment node ID, the keyword prefixes (`!vouch`/`!denounce`/`!unvouch`), and the permitted roles (`admin,maintain,write`).

Both vouch workflows generate a GitHub App token first via `actions/create-github-app-token@v3` (using `secrets.APP_CLIENT_ID` and `secrets.APP_PRIVATE_KEY`) and pass that token to the action as `GITHUB_TOKEN`. There is no fallback to `secrets.GITHUB_TOKEN`. `vouch-manage.yml` also declares a workflow-scoped `concurrency: group: vouch-manage` with `cancel-in-progress: false` so multiple Discussion comments queue rather than cancel each other.

## PR gate

`.github/workflows/vouch-pr.yml` runs on `pull_request_target` for `opened`, `reopened`, and `ready_for_review` events. The workflow generates a GitHub App token via `actions/create-github-app-token@v3` and runs `mitchellh/vouch/action/check-pr@v1` with `require-vouch: true` and `auto-close: true`:

- Allowed automatically: bots, collaborators with write access, and explicitly vouched users.
- Otherwise the PR is closed automatically (with a comment explaining how to get vouched).
- When the PR is vouched or already allowed, the workflow creates/forces a `vouched` label (color `2da44e`) and applies it to the PR via `gh label create --force` + `gh pr edit --add-label` (first removing any stale `vouched` label with `--remove-label` to avoid a no-op).

The workflow runs under `pull_request_target` so it can act on pull requests from forks. Concurrency is scoped per PR (`vouch-pr-${{ github.event.pull_request.number }}`) with `cancel-in-progress: true`.

## Permissions

- `vouch-manage.yml` needs `contents: write`, `discussions: write`, and `pull-requests: write`.
- `vouch-pr.yml` needs `contents: read`, `pull-requests: write`, `issues: write`.
- `vouch-pr.yml` needs `contents: read`, `pull-requests: write`, `issues: write`, and `id-token: write`.

The `id-token: write` permission is required by the GitHub App token step; the vouch action itself authenticates with the generated App token (`GITHUB_TOKEN: ${{ steps.app-token.outputs.token }}`), and the PR gate's `gh label`/`gh pr edit` commands use the same token via `GH_TOKEN`.

## Requesting a vouch

Contributors who are not already collaborators should open a Discussion describing their proposed contribution. A maintainer can then vouch them by commenting `!vouch` on that Discussion. Once vouched, future pull requests will pass the gate.
