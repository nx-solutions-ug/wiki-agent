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

  const executeTool: Tool = {
    definition: {
      type: "function",
      function: {
        name: "execute",
        description:
          "Run a shell command in the project root. Use for git log, git diff, etc.",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The shell command to run",
            },
          },
          required: ["command"],
        },
      },
    },
    handler: async (args) => {
      const command = args.command as string;

      // Prevent the agent from recursively invoking itself
      const blocked = /\b(wiki\b|wiki-agent|dist\/cli\.js)/i.test(command);
      if (blocked) {
        return "Error: This command is blocked. The wiki agent cannot invoke itself or the wiki CLI.";
      }

      try {
        const { stdout, stderr } = await execAsync(command, {
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

  return [readFileTool, writeFileTool, editFileTool, lsTool, grepTool, globTool, executeTool];
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