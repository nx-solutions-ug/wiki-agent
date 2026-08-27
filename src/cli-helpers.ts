/**
 * Shared CLI helper functions extracted from cli.tsx so they can be reused
 * by other entry points (e.g. the MCP server).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Returns a `git log --oneline -30` summary of the repository at cwd.
 * Falls back to a placeholder string if git is unavailable.
 */
export async function getGitSummary(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["log", "--oneline", "-30"], {
      cwd,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    return "(git not available or not a git repository)";
  }
}

/**
 * Returns the configured Git user.name in the repository (or globally).
 * Returns null if not configured or git is unavailable.
 */
export async function getGitUserName(cwd?: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["config", "user.name"], {
      cwd: cwd || process.cwd(),
      maxBuffer: 1024 * 1024,
    });
    const name = stdout.trim();
    return name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

export interface ResolveUpdatedByOptions {
  updatedBy?: string;
  isMcp?: boolean;
  isAutomated?: boolean;
}

/**
 * Resolves the updated_by author string for wiki frontmatter:
 * a. "wiki-agent" for automated updates (CI, GitHub Actions, or isAutomated: true)
 * b. "mcp-server" for updates triggered by the MCP server
 * c. Git user.name for updates triggered by a user (falling back to user environment variables or "wiki-agent")
 * Explicit option or WIKI_UPDATED_BY environment variable overrides take precedence.
 */
export async function resolveUpdatedBy(
  projectRoot?: string,
  options?: ResolveUpdatedByOptions,
): Promise<string> {
  if (options?.updatedBy) {
    return options.updatedBy;
  }

  if (process.env.WIKI_UPDATED_BY) {
    return process.env.WIKI_UPDATED_BY;
  }

  if (options?.isMcp || process.env.WIKI_MCP === "true" || process.env.WIKI_MCP === "1") {
    return "mcp-server";
  }

  const isAutomated =
    options?.isAutomated ||
    Boolean(process.env.CI) ||
    Boolean(process.env.GITHUB_ACTIONS) ||
    process.env.WIKI_AUTOMATED === "true" ||
    process.env.WIKI_AUTOMATED === "1";

  if (isAutomated) {
    return "wiki-agent";
  }

  const gitUser = await getGitUserName(projectRoot);
  if (gitUser) {
    return gitUser;
  }

  return (
    process.env.GIT_AUTHOR_NAME ||
    process.env.USER ||
    process.env.USERNAME ||
    "wiki-agent"
  );
}