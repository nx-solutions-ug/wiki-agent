import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Tool, parseArgsStringToArgv, truncateResult } from "./helpers.js";

const execFileAsync = promisify(execFile);

export function createGitTool(projectRoot: string): Tool {
  return {
    definition: {
      type: "function",
      function: {
        name: "git",
        description:
          "Run a read-only git subcommand in the project root. Use for git log, git diff, git show, git ls-files, git blame, etc. The agent has no general shell access — only git is exposed for repository history and inspection.",
        parameters: {
          type: "object",
          properties: {
            args: {
              type: "string",
              description:
                "Git subcommand and arguments, without the leading 'git'. Example: 'log --oneline -30', 'diff --stat', 'ls-files', 'show HEAD:README.md'.",
            },
          },
          required: ["args"],
        },
      },
    },
    handler: async (args) => {
      const argString = (args.args as string) ?? "";

      const ALLOWED_GIT_SUBCOMMANDS: Record<string, true> = {
        log: true, diff: true, show: true, "ls-files": true, blame: true,
        status: true, remote: true, describe: true, "rev-parse": true,
        shortlog: true, "name-rev": true, "ls-tree": true, "cat-file": true,
        reflog: true,
      };

      const tokens = parseArgsStringToArgv(argString);
      const subcommand = tokens[0] ?? "";
      if (!ALLOWED_GIT_SUBCOMMANDS[subcommand]) {
        return `Error: git subcommand '${subcommand}' is not permitted. Only read-only inspection subcommands are allowed (log, diff, show, ls-files, blame, status, remote, describe, rev-parse, shortlog, name-rev, ls-tree, cat-file, reflog).`;
      }

      if (/[;&|`$()<>]/.test(argString)) {
        return "Error: shell metacharacters are not permitted in git arguments.";
      }

      try {
        const { stdout, stderr } = await execFileAsync("git", tokens, {
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
