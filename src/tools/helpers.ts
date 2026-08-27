import path from "node:path";
import { parseDocument } from "yaml";

export const EXCLUDED_DIRS = ["node_modules", ".git", "dist", ".wiki"];

export function parseArgsStringToArgv(value: string): string[] {
  const tokens: string[] = [];
  let currentToken = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (escaped) {
      currentToken += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
      if (currentToken.length > 0) {
        tokens.push(currentToken);
        currentToken = '';
      }
      continue;
    }
    currentToken += char;
  }
  if (currentToken.length > 0) {
    tokens.push(currentToken);
  }
  return tokens;
}

export const MAX_READ_LENGTH = 50_000;
export const MAX_TOOL_RESULT_LENGTH = 10_000;

const THINKING_TAG_PAIR_RE = /<((?:think|thinking|reasoning|reflection))\b[^>]*>([\s\S]*?)<\/\1>/gi;
const THINKING_TAG_ORPHAN_RE = /<\/?(?:think|thinking|reasoning|reflection)\b[^>]*>/gi;

export function stripThinkingTags(content: string): string {
  if (!content.includes("<")) return content;
  let stripped = content;
  let prev: string;
  do {
    prev = stripped;
    stripped = stripped.replace(THINKING_TAG_PAIR_RE, "");
  } while (stripped !== prev);
  stripped = stripped.replace(THINKING_TAG_ORPHAN_RE, "");
  return stripped.replace(/^\s+/, "");
}

export function isMarkdownFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".md" || ext === ".markdown";
}

export function injectOrUpdateFrontmatter(
  content: string,
  metadata: { last_updated: string; updated_by: string },
): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content);
  if (match) {
    const rawYaml = match[1];
    const rest = content.slice(match[0].length);
    try {
      const doc = parseDocument(rawYaml);
      doc.set("last_updated", metadata.last_updated);
      doc.set("updated_by", metadata.updated_by);
      const updatedYaml = doc.toString().trim();
      const prefix = `---\n${updatedYaml}\n---`;
      if (!rest) {
        return prefix + "\n";
      }
      return `${prefix}\n${rest.startsWith("\n") ? rest : "\n" + rest}`;
    } catch {
      const doc = parseDocument("");
      doc.set("last_updated", metadata.last_updated);
      doc.set("updated_by", metadata.updated_by);
      const updatedYaml = doc.toString().trim();
      return `---\n${rawYaml.trim()}\n${updatedYaml}\n---\n${rest.startsWith("\n") ? rest : "\n" + rest}`;
    }
  }

  const doc = parseDocument("");
  doc.set("last_updated", metadata.last_updated);
  doc.set("updated_by", metadata.updated_by);
  const yamlStr = doc.toString().trim();
  const trimmedLeading = content.replace(/^\r?\n+/, "");
  if (!trimmedLeading) {
    return `---\n${yamlStr}\n---\n`;
  }
  return `---\n${yamlStr}\n---\n\n${trimmedLeading}`;
}

export interface ToolOptions {
  updatedBy?: string;
  lastUpdated?: string;
}

export interface ToolDefinition {
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

export function truncateResult(result: string): string {
  if (result.length <= MAX_TOOL_RESULT_LENGTH) {
    return result;
  }

  return result.slice(0, MAX_TOOL_RESULT_LENGTH) + "\n... (truncated)";
}

export function resolveWikiPath(
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

export function resolveProjectPath(
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
