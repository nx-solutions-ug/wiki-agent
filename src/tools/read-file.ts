import { createReadStream } from "node:fs";
import readline from "node:readline";
import { Tool, resolveProjectPath, truncateResult } from "./helpers.js";

export function createReadFileTool(projectRoot: string): Tool {
  return {
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

      const selectedLines: string[] = [];
      const stream = createReadStream(filePath, { encoding: "utf8" });
      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

      let currentLine = 0;
      for await (const line of rl) {
        if (currentLine >= offset && currentLine < offset + limit) {
          selectedLines.push(line);
        }
        currentLine++;
        if (currentLine >= offset + limit) {
          rl.close();
          stream.destroy();
          break;
        }
      }

      const result = selectedLines.join("\n");
      return truncateResult(result);
    },
  };
}
