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