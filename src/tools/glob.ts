import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  Tool,
  EXCLUDED_DIRS,
  resolveProjectPath,
  truncateResult,
} from "./helpers.js";

const execFileAsync = promisify(execFile);

export function createGlobTool(projectRoot: string): Tool {
  return {
    definition: {
      type: "function",
      function: {
        name: "glob",
        description:
          "Find files matching a filename pattern. Uses the system find command, which searches recursively from the given path.",
        parameters: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "Glob pattern matched against filenames. * matches within a filename (e.g. *.ts, *.test.ts). find searches recursively, so *.ts matches at any depth without **. Use the path parameter to scope to a subdirectory.",
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
        .replace(/^\*\*\//, "")
        .replace(/\*\*\//g, "");
      const cmdArgs = [
        searchPath,
        "-name", findPattern,
        "-type", "f",
        ...EXCLUDED_DIRS.flatMap((dir) => ["-not", "-path", `*/${dir}/*`]),
      ];

      try {
        const { stdout } = await execFileAsync("find", cmdArgs, {
          cwd: projectRoot,
          maxBuffer: 1024 * 1024,
        });
        return truncateResult(stdout || "(no files found)");
      } catch {
        return "(no files found)";
      }
    },
  };
}
