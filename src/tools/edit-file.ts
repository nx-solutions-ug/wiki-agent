import { readFile, writeFile } from "node:fs/promises";
import { resolveUpdatedBy } from "../cli-helpers.js";
import {
  Tool,
  ToolOptions,
  resolveWikiPath,
  stripThinkingTags,
  isMarkdownFile,
  injectOrUpdateFrontmatter,
} from "./helpers.js";

export function createEditFileTool(projectRoot: string, options?: ToolOptions): Tool {
  return {
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
      const newString = stripThinkingTags(args.new_string as string);

      const content = await readFile(filePath, "utf8");
      let newContent = content.replace(oldString, newString);

      if (newContent === content) {
        return `No match found for old_string in ${args.path}`;
      }

      if (isMarkdownFile(filePath)) {
        const updater = options?.updatedBy ?? await resolveUpdatedBy(projectRoot);
        const lastUpdated = options?.lastUpdated ?? new Date().toISOString();
        newContent = injectOrUpdateFrontmatter(newContent, {
          last_updated: lastUpdated,
          updated_by: updater,
        });
      }

      await writeFile(filePath, newContent, "utf8");

      return `Edited ${args.path}`;
    },
  };
}
