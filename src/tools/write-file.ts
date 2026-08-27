import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { resolveUpdatedBy } from "../cli-helpers.js";
import {
  Tool,
  ToolOptions,
  resolveWikiPath,
  stripThinkingTags,
  isMarkdownFile,
  injectOrUpdateFrontmatter,
} from "./helpers.js";

export function createWriteFileTool(projectRoot: string, options?: ToolOptions): Tool {
  return {
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
      let content = stripThinkingTags(args.content as string);

      if (isMarkdownFile(filePath)) {
        const updater = options?.updatedBy ?? await resolveUpdatedBy(projectRoot);
        const lastUpdated = options?.lastUpdated ?? new Date().toISOString();
        content = injectOrUpdateFrontmatter(content, {
          last_updated: lastUpdated,
          updated_by: updater,
        });
      }

      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content, "utf8");

      return `Wrote ${args.path}`;
    },
  };
}
