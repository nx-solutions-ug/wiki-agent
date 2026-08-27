import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Tool, parseArgsStringToArgv, truncateResult } from "./helpers.js";

const execFileAsync = promisify(execFile);

export function createGhTool(projectRoot: string): Tool {
  return {
    definition: {
      type: "function",
      function: {
        name: "gh",
        description:
          "Run a GitHub CLI (gh) subcommand in the project root. Read-only inspection (pr list, pr view, pr diff, repo view, issue list, etc.) is always allowed. Two mutating operations are permitted but ONLY on wiki staging PRs (branches matching wiki/staging-*): `gh pr close <number>` and `gh pr comment <number> --body <text>`. Use to inspect open PRs, check staging branch timestamps, and close stale wiki staging PRs with a comment.",
        parameters: {
          type: "object",
          properties: {
            args: {
              type: "string",
              description:
                "gh subcommand and arguments, without the leading 'gh'. Example: 'pr list --state open --json number,headRefName,title', 'pr view <number> --json headRefName', 'pr close <number> --comment \"This branch is from an earlier staging run and is stale. Closing\"', 'pr comment <number> --body \"stale\"'.",
            },
          },
          required: ["args"],
        },
      },
    },
    handler: async (args) => {
      const argString = (args.args as string) ?? "";

      const ALLOWED_GH_SUBCOMMANDS: Record<string, true> = {
        pr: true, issue: true, repo: true, run: true, api: true,
        "search": true, release: true, label: true, workflow: true,
      };

      const BLOCKED_ACTIONS: Record<string, true> = {
        create: true, edit: true, reopen: true, merge: true,
        delete: true, ready: true, review: true,
        lock: true, unlock: true, assign: true, unassign: true,
        label: true, unlabel: true, transfer: true, archive: true,
        unarchive: true, deploy: true, rerun: true, cancel: true,
        publish: true, set: true, add: true, remove: true,
      };

      const STAGING_ONLY_ACTIONS: Record<string, true> = {
        close: true, comment: true,
      };

      const tokens = parseArgsStringToArgv(argString);
      const subcommand = tokens[0] ?? "";
      if (!ALLOWED_GH_SUBCOMMANDS[subcommand]) {
        return `Error: gh subcommand '${subcommand}' is not permitted. Only inspection subcommands and pr close/comment on wiki staging PRs are allowed (pr, issue, repo, run, api, search, release, label, workflow).`;
      }

      const action = tokens[1] ?? "";

      if (BLOCKED_ACTIONS[action]) {
        return `Error: gh ${subcommand} ${action} is a blocked operation.`;
      }

      if (STAGING_ONLY_ACTIONS[action] && subcommand === "pr") {
        const prNumber = tokens[2] ?? "";
        if (!/^\d+$/.test(prNumber)) {
          return `Error: a valid PR number is required for gh pr ${action}.`;
        }

        try {
          const { stdout } = await execFileAsync(
            "gh", ["pr", "view", prNumber, "--json", "headRefName"],
            { cwd: projectRoot, maxBuffer: 1024 * 1024, timeout: 30_000 }
          );
          const parsed = JSON.parse(stdout) as { headRefName?: string };
          if (!parsed.headRefName?.startsWith("wiki/staging-")) {
            return `Error: gh pr ${action} is only permitted on wiki staging PRs (branches matching wiki/staging-*). PR #${prNumber} has headRefName '${parsed.headRefName ?? "unknown"}'.`;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return `Error: could not verify PR #${prNumber} is a wiki staging PR: ${message}`;
        }
      } else if (STAGING_ONLY_ACTIONS[action]) {
        return `Error: gh ${subcommand} ${action} is not supported. Only gh pr ${action} is permitted, and only on wiki staging PRs.`;
      }

      if (/[;&|`$()<>]/.test(argString)) {
        return "Error: shell metacharacters are not permitted in gh arguments.";
      }

      try {
        const { stdout, stderr } = await execFileAsync("gh", tokens, {
          cwd: projectRoot,
          maxBuffer: 1024 * 1024,
          timeout: 30_000,
        });

        const result = stdout + (stderr ? `\n${stderr}` : "");
        return truncateResult(result || "(no output)");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return truncateResult(`Error: ${message}`);
      }
    },
  };
}
