import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  Tool,
  EXCLUDED_DIRS,
  resolveProjectPath,
  truncateResult,
} from "./helpers.js";

const execFileAsync = promisify(execFile);

export function createGrepTool(projectRoot: string): Tool {
  return {
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

      const defaultIncludes = [
        "*.ts", "*.tsx", "*.js", "*.jsx", "*.py", "*.go", "*.rs",
        "*.java", "*.rb", "*.php", "*.md", "*.yml", "*.yaml",
        "*.json", "*.toml", "*.sh",
      ];
      const includeFlags = globPattern
        ? ["--include=" + globPattern]
        : defaultIncludes.map((g) => "--include=" + g);

      const cmdArgs = [
        "-rn",
        ...EXCLUDED_DIRS.map((dir) => `--exclude-dir=${dir}`),
        ...includeFlags,
        "--",
        pattern,
        searchPath,
      ];

      try {
        const { stdout } = await execFileAsync("grep", cmdArgs, {
          cwd: projectRoot,
          maxBuffer: 1024 * 1024,
        });
        return truncateResult(stdout || "(no matches)");
      } catch {
        return "(no matches)";
      }
    },
  };
}
