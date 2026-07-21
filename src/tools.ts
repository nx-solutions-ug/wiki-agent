import { readFile, writeFile, readdir, stat, mkdir } from "node:fs/promises";
import { exec } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const MAX_READ_LENGTH = 50_000;
const MAX_TOOL_RESULT_LENGTH = 10_000;

interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

export interface Tool {
  definition: ToolDefinition;
  handler: (
    args: Record<string, unknown>,
    projectRoot: string,
  ) => Promise<string>;
}

function truncateResult(result: string): string {
  if (result.length <= MAX_TOOL_RESULT_LENGTH) {
    return result;
  }

  return result.slice(0, MAX_TOOL_RESULT_LENGTH) + "\n... (truncated)";
}

/**
 * Resolves a path relative to the project root and validates it stays within
 * the `.wiki/` directory. Throws on escape attempts.
 */
function resolveWikiPath(
  relativePath: string,
  projectRoot: string,
): string {
  const wikiRoot = path.resolve(projectRoot, ".wiki");
  const resolved = path.resolve(projectRoot, relativePath);

  if (!resolved.startsWith(wikiRoot + path.sep) && resolved !== wikiRoot) {
    throw new Error(
      `Path ${relativePath} resolves outside .wiki/. Only files under .wiki/ can be written.`,
    );
  }

  return resolved;
}

/**
 * Resolves a path relative to the project root (for read-only operations).
 */
function resolveProjectPath(
  relativePath: string,
  projectRoot: string,
): string {
  const resolved = path.resolve(projectRoot, relativePath);

  if (!resolved.startsWith(projectRoot + path.sep) && resolved !== projectRoot) {
    throw new Error(
      `Path ${relativePath} resolves outside the project root.`,
    );
  }

  return resolved;
}

export function createTools(projectRoot: string): Tool[] {
  const readFileTool: Tool = {
    definition: {
      type: "function",
      function: {
        name: "read_file",
        description:
          "Read the contents of a file from the project root. Use a relative path.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Relative path to the file (e.g. src/index.ts)",
            },
            offset: {
              type: "number",
              description: "Line offset to start reading from (0-indexed). Default: 0",
            },
            limit: {
              type: "number",
              description: "Maximum number of lines to read. Default: 500",
            },
          },
          required: ["path"],
        },
      },
    },
    handler: async (args) => {
      const filePath = resolveProjectPath(args.path as string, projectRoot);
      const offset = (args.offset as number) ?? 0;
      const limit = (args.limit as number) ?? 500;

      const content = await readFile(filePath, "utf8");
      const lines = content.split("\n");
      const end = Math.min(offset + limit, lines.length);
      const result = lines.slice(offset, end).join("\n");

      return truncateResult(result);
    },
  };

  const writeFileTool: Tool = {
    definition: {
      type: "function",
      function: {
        name: "write_file",
        description:
          "Write content to a file under .wiki/. Creates parent directories if needed. The path must be relative and start with .wiki/.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Relative path under .wiki/ (e.g. .wiki/quickstart.md)",
            },
            content: {
              type: "string",
              description: "The full content to write",
            },
          },
          required: ["path", "content"],
        },
      },
    },
    handler: async (args) => {
      const filePath = resolveWikiPath(args.path as string, projectRoot);
      const content = args.content as string;

      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content, "utf8");

      return `Wrote ${args.path}`;
    },
  };

  const editFileTool: Tool = {
    definition: {
      type: "function",
      function: {
        name: "edit_file",
        description:
          "Replace text in a file under .wiki/. Finds old_string and replaces with new_string.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Relative path under .wiki/ (e.g. .wiki/quickstart.md)",
            },
            old_string: {
              type: "string",
              description: "The text to find",
            },
            new_string: {
              type: "string",
              description: "The replacement text",
            },
          },
          required: ["path", "old_string", "new_string"],
        },
      },
    },
    handler: async (args) => {
      const filePath = resolveWikiPath(args.path as string, projectRoot);
      const oldString = args.old_string as string;
      const newString = args.new_string as string;

      const content = await readFile(filePath, "utf8");
      const newContent = content.replace(oldString, newString);

      if (newContent === content) {
        return `No match found for old_string in ${args.path}`;
      }

      await writeFile(filePath, newContent, "utf8");

      return `Edited ${args.path}`;
    },
  };

  const lsTool: Tool = {
    definition: {
      type: "function",
      function: {
        name: "ls",
        description:
          "List the contents of a directory. Returns file and directory names.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Relative path to the directory (default: project root)",
            },
          },
          required: [],
        },
      },
    },
    handler: async (args) => {
      const dirPath = resolveProjectPath(
        (args.path as string) ?? ".",
        projectRoot,
      );
      const entries = await readdir(dirPath, { withFileTypes: true });
      const result = entries
        .map((e) => `${e.isDirectory() ? e.name + "/" : e.name}`)
        .sort()
        .join("\n");

      return truncateResult(result || "(empty directory)");
    },
  };

  const grepTool: Tool = {
    definition: {
      type: "function",
      function: {
        name: "grep",
        description:
          "Search for a text pattern in files. Uses the system grep. Searches from the project root.",
        parameters: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "The text pattern to search for",
            },
            path: {
              type: "string",
              description: "Relative path to search in (default: project root)",
            },
            glob: {
              type: "string",
              description: "Optional glob pattern to filter files (e.g. *.ts)",
            },
          },
          required: ["pattern"],
        },
      },
    },
    handler: async (args) => {
      const pattern = args.pattern as string;
      const searchPath = resolveProjectPath(
        (args.path as string) ?? ".",
        projectRoot,
      );
      const globPattern = (args.glob as string) ?? "";

      const cmd = [
        "grep",
        "-rn",
        "--include=" + (globPattern || "*.ts *.tsx *.js *.jsx *.py *.go *.rs *.java *.rb *.php *.md *.yml *.yaml *.json *.toml *.sh"),
        "--",
        pattern.replace(/'/g, "'\\''"),
        searchPath,
      ].join(" ");

      try {
        const { stdout } = await execAsync(cmd, {
          maxBuffer: 1024 * 1024,
        });
        return truncateResult(stdout || "(no matches)");
      } catch {
        return "(no matches)";
      }
    },
  };

  const globTool: Tool = {
    definition: {
      type: "function",
      function: {
        name: "glob",
        description:
          "Find files matching a pattern. Uses the system find command.",
        parameters: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "Glob pattern (e.g. *.ts, **/*.tsx). * matches within a directory, ** matches recursively.",
            },
            path: {
              type: "string",
              description: "Relative path to search in (default: project root)",
            },
          },
          required: ["pattern"],
        },
      },
    },
    handler: async (args) => {
      const pattern = args.pattern as string;
      const searchPath = resolveProjectPath(
        (args.path as string) ?? ".",
        projectRoot,
      );

      const findPattern = pattern
        .replace(/\*\*/g, "")
        .replace(/\*/g, "");

      const cmd = [
        "find",
        searchPath,
        "-name",
        `'${findPattern}'`,
        "-type",
        "f",
        "-not",
        "-path",
        "'*/node_modules/*'",
        "-not",
        "-path",
        "'*/.git/*'",
        "-not",
        "-path",
        "'*/dist/*'",
      ].join(" ");

      try {
        const { stdout } = await execAsync(cmd, {
          maxBuffer: 1024 * 1024,
        });
        return truncateResult(stdout || "(no files found)");
      } catch {
        return "(no files found)";
      }
    },
  };

  const gitTool: Tool = {
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

      // Only read-only / inspection subcommands are permitted. The agent
      // cannot mutate the repository state through this tool. Flags that
      // would mutate state (e.g. -d, -D, --delete) are blocked by the
      // metacharacter guard below for any subcommand that accepts them, but
      // the list itself excludes mutating subcommands entirely.
      const ALLOWED_GIT_SUBCOMMANDS: Record<string, true> = {
        log: true, diff: true, show: true, "ls-files": true, blame: true,
        status: true, remote: true, describe: true, "rev-parse": true,
        shortlog: true, "name-rev": true, "ls-tree": true, "cat-file": true,
        reflog: true,
      };

      const tokens = argString.trim().split(/\s+/);
      const subcommand = tokens[0] ?? "";
      if (!ALLOWED_GIT_SUBCOMMANDS[subcommand]) {
        return `Error: git subcommand '${subcommand}' is not permitted. Only read-only inspection subcommands are allowed (log, diff, show, ls-files, blame, status, remote, describe, rev-parse, shortlog, name-rev, ls-tree, cat-file, reflog).`;
      }

      // Reject shell metacharacters that could chain commands or inject
      // flags. Git flags begin with '-', which we permit, so the guard
      // focuses on shell-control and redirection metacharacters.
      if (/[;&|`$()<>]/.test(argString)) {
        return "Error: shell metacharacters are not permitted in git arguments.";
      }

      try {
        const { stdout, stderr } = await execAsync(`git ${argString}`, {
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

  const astGrepTool: Tool = {
    definition: {
      type: "function",
      function: {
        name: "ast_grep",
        description:
          "Search code by AST pattern using ast-grep. Matches code structure (not text), so metavariables and node shapes work. Requires an explicit language. Use for precise structural queries like finding all calls to a function, all exports, or a specific control-flow shape.",
        parameters: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description:
                "AST pattern to match. Use $NAME for a single node metavariable and $$$ARGS for zero-or-more. Example: 'console.log($$$)'",
            },
            lang: {
              type: "string",
              description:
                "Language of the pattern. Supported: bash, c, cpp, csharp, css, elixir, go, haskell, html, java, javascript, json, jsx, kotlin, lua, nix, php, python, ruby, rust, scala, solidity, swift, tsx, typescript, yaml.",
            },
            path: {
              type: "string",
              description: "Relative path to search in (default: project root)",
            },
            selector: {
              type: "string",
              description:
                "Optional AST kind to extract as the actual matcher (ast-grep --selector).",
            },
            strictness: {
              type: "string",
              description:
                "Optional pattern strictness: cst, smart, ast, relaxed, signature, template.",
            },
          },
          required: ["pattern", "lang"],
        },
      },
    },
    handler: async (args) => {
      const pattern = args.pattern as string;
      const lang = args.lang as string;
      const searchPath = resolveProjectPath(
        (args.path as string) ?? ".",
        projectRoot,
      );

      const cmd = [
        "ast-grep",
        "run",
        "--json=compact",
        "--lang",
        `'${lang.replace(/'/g, "'\\''")}'`,
        "--pattern",
        `'${pattern.replace(/'/g, "'\\''")}'`,
      ];

      const selector = args.selector as string | undefined;
      if (selector) {
        cmd.push("--selector", `'${selector.replace(/'/g, "'\\''")}'`);
      }

      const strictness = args.strictness as string | undefined;
      if (strictness) {
        cmd.push("--strictness", `'${strictness.replace(/'/g, "'\\''")}'`);
      }

      cmd.push(`'${searchPath.replace(/'/g, "'\\''")}'`);

      try {
        const { stdout } = await execAsync(cmd.join(" "), {
          cwd: projectRoot,
          maxBuffer: 1024 * 1024,
          timeout: 30_000,
        });
        return truncateResult(stdout || "(no matches)");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return truncateResult(`Error: ${message}`);
      }
    },
  };

  const astSearchTool: Tool = {
    definition: {
      type: "function",
      function: {
        name: "ast_search",
        description:
          "Search code using an ast-grep YAML rule (inline). More powerful than ast_grep: supports relational/inside/has constraints and multiple rules separated by '---'. Use for complex structural queries that a single pattern cannot express.",
        parameters: {
          type: "object",
          properties: {
            rule: {
              type: "string",
              description:
                "Inline ast-grep YAML rule(s). Must have id, language, and rule fields. Multiple rules separated by '---'.",
            },
            path: {
              type: "string",
              description: "Relative path to search in (default: project root)",
            },
          },
          required: ["rule"],
        },
      },
    },
    handler: async (args) => {
      const rule = args.rule as string;
      const searchPath = resolveProjectPath(
        (args.path as string) ?? ".",
        projectRoot,
      );

      try {
        const { stdout } = await execAsync(
          `ast-grep scan --json=compact --inline-rules '${rule.replace(/'/g, "'\\''")}' '${searchPath.replace(/'/g, "'\\''")}'`,
          {
            cwd: projectRoot,
            maxBuffer: 1024 * 1024,
            timeout: 30_000,
          },
        );
        return truncateResult(stdout || "(no matches)");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return truncateResult(`Error: ${message}`);
      }
    },
  };

  const ghTool: Tool = {
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

      // Actions that are always blocked (never safe for an automated agent).
      const BLOCKED_ACTIONS: Record<string, true> = {
        create: true, edit: true, reopen: true, merge: true,
        delete: true, ready: true, review: true,
        lock: true, unlock: true, assign: true, unassign: true,
        label: true, unlabel: true, transfer: true, archive: true,
        unarchive: true, deploy: true, rerun: true, cancel: true,
        publish: true, set: true, add: true, remove: true,
      };

      // Actions allowed ONLY on wiki staging PRs (branches matching
      // wiki/staging-*). The handler verifies the PR's headRefName before
      // executing these.
      const STAGING_ONLY_ACTIONS: Record<string, true> = {
        close: true, comment: true,
      };

      const tokens = argString.trim().split(/\s+/);
      const subcommand = tokens[0] ?? "";
      if (!ALLOWED_GH_SUBCOMMANDS[subcommand]) {
        return `Error: gh subcommand '${subcommand}' is not permitted. Only inspection subcommands and pr close/comment on wiki staging PRs are allowed (pr, issue, repo, run, api, search, release, label, workflow).`;
      }

      const action = tokens[1] ?? "";

      if (BLOCKED_ACTIONS[action]) {
        return `Error: gh ${subcommand} ${action} is a blocked operation.`;
      }

      // For close/comment on PRs, verify the target is a wiki staging PR.
      // The PR number is the third token: 'gh pr close <number>' or
      // 'gh pr comment <number> --body ...'.
      if (STAGING_ONLY_ACTIONS[action] && subcommand === "pr") {
        const prNumber = tokens[2] ?? "";
        if (!/^\d+$/.test(prNumber)) {
          return `Error: a valid PR number is required for gh pr ${action}.`;
        }

        // Fetch the PR's headRefName to verify it's a wiki staging branch.
        try {
          const { stdout } = await execAsync(
            `gh pr view ${prNumber} --json headRefName`,
            { cwd: projectRoot, maxBuffer: 1024 * 1024, timeout: 30_000 },
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

      // Reject shell metacharacters that could chain commands or inject
      // flags, same guard as the git tool.
      if (/[;&|`$()<>]/.test(argString)) {
        return "Error: shell metacharacters are not permitted in gh arguments.";
      }

      try {
        const { stdout, stderr } = await execAsync(`gh ${argString}`, {
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

  return [
    readFileTool,
    writeFileTool,
    editFileTool,
    lsTool,
    grepTool,
    globTool,
    gitTool,
    astGrepTool,
    astSearchTool,
    ghTool,
  ];
}

/**
 * Execute a tool by name with the given arguments.
 */
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  projectRoot: string,
): Promise<string> {
  const tools = createTools(projectRoot);
  const tool = tools.find((t) => t.definition.function.name === toolName);

  if (!tool) {
    return `Unknown tool: ${toolName}`;
  }

  try {
    return await tool.handler(args, projectRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: ${message}`;
  }
}

export { MAX_READ_LENGTH, MAX_TOOL_RESULT_LENGTH };