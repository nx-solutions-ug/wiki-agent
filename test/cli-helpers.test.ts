import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { getGitUserName, resolveUpdatedBy } from "../src/cli-helpers.js";

const execFileAsync = promisify(execFile);

function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "wiki-cli-helpers-test-"));
}

describe("cli-helpers", () => {
  let projectRoot: string;
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    projectRoot = await tempDir();
    process.env = { ...originalEnv };
    delete process.env.CI;
    delete process.env.GITHUB_ACTIONS;
    delete process.env.WIKI_AUTOMATED;
    delete process.env.WIKI_UPDATED_BY;
    delete process.env.WIKI_MCP;
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await rm(projectRoot, { recursive: true, force: true });
  });

  describe("getGitUserName", () => {
    test("returns git user.name when git repo is initialized with user.name", async () => {
      await execFileAsync("git", ["init"], { cwd: projectRoot });
      await execFileAsync("git", ["config", "user.name", "Alice Test"], { cwd: projectRoot });

      const name = await getGitUserName(projectRoot);
      expect(name).toBe("Alice Test");
    });

    test("returns null or string when path is invalid", async () => {
      const name = await getGitUserName("/invalid-path-nonexistent");
      expect(name === null || typeof name === "string").toBe(true);
    });
  });

  describe("resolveUpdatedBy", () => {
    test("explicit updatedBy option takes highest precedence", async () => {
      process.env.CI = "true";
      process.env.WIKI_UPDATED_BY = "custom-env";

      const author = await resolveUpdatedBy(projectRoot, {
        updatedBy: "custom-author",
      });
      expect(author).toBe("custom-author");
    });

    test("WIKI_UPDATED_BY environment variable overrides other heuristics", async () => {
      process.env.WIKI_UPDATED_BY = "env-author";
      process.env.CI = "true";

      const author = await resolveUpdatedBy(projectRoot);
      expect(author).toBe("env-author");
    });

    test("returns 'mcp-server' when isMcp is set or WIKI_MCP is true", async () => {
      const author1 = await resolveUpdatedBy(projectRoot, { isMcp: true });
      expect(author1).toBe("mcp-server");

      process.env.WIKI_MCP = "true";
      const author2 = await resolveUpdatedBy(projectRoot);
      expect(author2).toBe("mcp-server");
    });

    test("returns 'wiki-agent' when CI or GITHUB_ACTIONS is true (automated update)", async () => {
      process.env.CI = "true";
      const authorCI = await resolveUpdatedBy(projectRoot);
      expect(authorCI).toBe("wiki-agent");

      delete process.env.CI;
      process.env.GITHUB_ACTIONS = "true";
      const authorGH = await resolveUpdatedBy(projectRoot);
      expect(authorGH).toBe("wiki-agent");

      delete process.env.GITHUB_ACTIONS;
      const authorAutomated = await resolveUpdatedBy(projectRoot, { isAutomated: true });
      expect(authorAutomated).toBe("wiki-agent");
    });

    test("returns git username when in local repo without CI", async () => {
      await execFileAsync("git", ["init"], { cwd: projectRoot });
      await execFileAsync("git", ["config", "user.name", "Bob Builder"], { cwd: projectRoot });

      const author = await resolveUpdatedBy(projectRoot);
      expect(author).toBe("Bob Builder");
    });
  });
});
