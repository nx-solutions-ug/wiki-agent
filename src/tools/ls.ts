import { readdir } from "node:fs/promises";
import { Tool, resolveProjectPath, truncateResult } from "./helpers.js";

export function createLsTool(projectRoot: string): Tool {
  return {
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
}
