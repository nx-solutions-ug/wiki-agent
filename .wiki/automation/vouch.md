---
type: Reference
title: Vouch Access Control
description: Discussion-driven vouching for maintainers and the PR gate that enforces it.
tags: [ github-actions, ci, automation, vouch, access-control ]
last_updated: 2026-09-03T20:42:17.104Z
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

The workflow checks out the repository with `actions/checkout@v7` and delegates to `mitchellh/vouch/action/manage-by-discussion@v1`, passing the discussion number, comment node ID, the keyword prefixes, and the permitted roles.

## PR gate

`.github/workflows/vouch-pr.yml` runs on `pull_request_target` for `opened`, `reopened`, and `ready_for_review` events. It uses `mitchellh/vouch/action/check-pr@v1` to decide whether a PR is allowed:

- Allowed automatically: bots, collaborators with write access, and explicitly vouched users.
- Otherwise: if `require-vouch: true` and `auto-close: true` are set, the PR is closed automatically.
- When the PR is vouched or already allowed, the workflow creates/forces a `vouched` label and applies it to the PR.

The workflow runs under `pull_request_target` so it can act on pull requests from forks. Concurrency is scoped per PR (`vouch-pr-${{ github.event.pull_request.number }}`) with `cancel-in-progress: true`.

## Permissions

- `vouch-manage.yml` needs `contents: write`, `discussions: write`, and `id-token: write`.
- `vouch-pr.yml` needs `contents: read`, `pull-requests: write`, `issues: write`, and `id-token: write`.

Both workflows generate a GitHub App token with `actions/create-github-app-token@v3` (from `secrets.APP_CLIENT_ID` / `secrets.APP_PRIVATE_KEY`) and pass it to the vouch action as `GITHUB_TOKEN`; the PR gate also uses it for the `gh label` / `gh pr edit` commands. They do not use `secrets.GITHUB_TOKEN` directly. Both workflows also request `id-token: write`.

## Requesting a vouch

Contributors who are not already collaborators should open a Discussion describing their proposed contribution. A maintainer can then vouch them by commenting `!vouch` on that Discussion. Once vouched, future pull requests will pass the gate.
