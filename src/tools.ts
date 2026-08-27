import { Tool, ToolOptions } from "./tools/helpers.js";
import { createReadFileTool } from "./tools/read-file.js";
import { createWriteFileTool } from "./tools/write-file.js";
import { createEditFileTool } from "./tools/edit-file.js";
import { createLsTool } from "./tools/ls.js";
import { createGrepTool } from "./tools/grep.js";
import { createGlobTool } from "./tools/glob.js";
import { createGitTool } from "./tools/git.js";
import { createAstGrepTool, createAstSearchTool } from "./tools/ast.js";
import { createGhTool } from "./tools/gh.js";

export * from "./tools/helpers.js";
export { createReadFileTool } from "./tools/read-file.js";
export { createWriteFileTool } from "./tools/write-file.js";
export { createEditFileTool } from "./tools/edit-file.js";
export { createLsTool } from "./tools/ls.js";
export { createGrepTool } from "./tools/grep.js";
export { createGlobTool } from "./tools/glob.js";
export { createGitTool } from "./tools/git.js";
export { createAstGrepTool, createAstSearchTool } from "./tools/ast.js";
export { createGhTool } from "./tools/gh.js";

export function createTools(projectRoot: string, options?: ToolOptions): Tool[] {
  return [
    createReadFileTool(projectRoot),
    createWriteFileTool(projectRoot, options),
    createEditFileTool(projectRoot, options),
    createLsTool(projectRoot),
    createGrepTool(projectRoot),
    createGlobTool(projectRoot),
    createGitTool(projectRoot),
    createAstGrepTool(projectRoot),
    createAstSearchTool(projectRoot),
    createGhTool(projectRoot),
  ];
}

// Memoize tool maps by project root
const toolsCache = new Map<string, Map<string, Tool>>();

/**
 * Execute a tool by name with the given arguments.
 */
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  projectRoot: string,
  options?: ToolOptions,
): Promise<string> {
  const cacheKey = options?.updatedBy ? `${projectRoot}::${options.updatedBy}` : projectRoot;
  let projectTools = toolsCache.get(cacheKey);
  if (!projectTools) {
    projectTools = new Map();
    const toolsList = createTools(projectRoot, options);
    for (const t of toolsList) {
      projectTools.set(t.definition.function.name, t);
    }
    toolsCache.set(cacheKey, projectTools);
  }
  const tool = projectTools.get(toolName);

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

export const _toolsCache = toolsCache;
export function clearToolsCache() {
  toolsCache.clear();
}
