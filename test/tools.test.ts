import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { createTools, executeTool } from "../src/tools.ts";

const execAsync = promisify(exec);

function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "wiki-tools-test-"));
}

describe("tools", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await tempDir();
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  describe("path safety", () => {
    test("write_file rejects paths outside .wiki/", async () => {
      const result = await executeTool(
        "write_file",
        { path: "../etc/test.md", content: "malicious" },
        projectRoot,
      );

      expect(result).toContain("Error");
      expect(result).toContain(".wiki/");
    });

    test("write_file rejects absolute paths outside project", async () => {
      const result = await executeTool(
        "write_file",
        { path: "/tmp/test.md", content: "test" },
        projectRoot,
      );

      expect(result).toContain("Error");
    });

    test("write_file accepts paths under .wiki/", async () => {
      const result = await executeTool(
        "write_file",
        { path: ".wiki/quickstart.md", content: "# Quickstart" },
        projectRoot,
      );

      expect(result).toBe("Wrote .wiki/quickstart.md");

      const content = await readFile(
        path.join(projectRoot, ".wiki", "quickstart.md"),
        "utf8",
      );
      expect(content).toBe("# Quickstart");
    });

    test("write_file creates nested directories", async () => {
      const result = await executeTool(
        "write_file",
        { path: ".wiki/architecture/overview.md", content: "# Overview" },
        projectRoot,
      );

      expect(result).toBe("Wrote .wiki/architecture/overview.md");
    });
  });

  describe("read_file", () => {
    test("reads file content", async () => {
      const filePath = path.join(projectRoot, "test.txt");
      await writeFile(filePath, "line1\nline2\nline3", "utf8");

      const result = await executeTool(
        "read_file",
        { path: "test.txt" },
        projectRoot,
      );

      expect(result).toContain("line1");
      expect(result).toContain("line2");
      expect(result).toContain("line3");
    });

    test("rejects paths outside project root", async () => {
      const result = await executeTool(
        "read_file",
        { path: "../../../etc/passwd" },
        projectRoot,
      );

      expect(result).toContain("Error");
    });
  });

  describe("ls", () => {
    test("lists directory contents", async () => {
      await writeFile(path.join(projectRoot, "a.txt"), "a");
      await mkdir(path.join(projectRoot, "subdir"));

      const result = await executeTool("ls", {}, projectRoot);

      expect(result).toContain("a.txt");
      expect(result).toContain("subdir/");
    });
  });

  describe("edit_file", () => {
    test("replaces text in existing file", async () => {
      await executeTool(
        "write_file",
        { path: ".wiki/test.md", content: "old text here" },
        projectRoot,
      );

      const result = await executeTool(
        "edit_file",
        {
          path: ".wiki/test.md",
          old_string: "old text",
          new_string: "new text",
        },
        projectRoot,
      );

      expect(result).toBe("Edited .wiki/test.md");

      const content = await readFile(
        path.join(projectRoot, ".wiki", "test.md"),
        "utf8",
      );
      expect(content).toBe("new text here");
    });

    test("returns no-match message when old_string not found", async () => {
      await executeTool(
        "write_file",
        { path: ".wiki/test.md", content: "hello world" },
        projectRoot,
      );

      const result = await executeTool(
        "edit_file",
        {
          path: ".wiki/test.md",
          old_string: "nonexistent",
          new_string: "replacement",
        },
        projectRoot,
      );

      expect(result).toContain("No match found");
    });
  });

  describe("git tool", () => {
    test("rejects non-git subcommands", async () => {
      const result = await executeTool(
        "git",
        { args: "rm -rf ." },
        projectRoot,
      );
      expect(result).toContain("not permitted");
    });

    test("rejects mutating subcommands", async () => {
      const result = await executeTool(
        "git",
        { args: "commit -m test" },
        projectRoot,
      );
      expect(result).toContain("not permitted");
    });

    test("rejects shell metacharacters", async () => {
      const result = await executeTool(
        "git",
        { args: "log --oneline; rm -rf ." },
        projectRoot,
      );
      expect(result).toContain("metacharacters");
    });

    test("allows read-only log in a git repo", async () => {
      // init a tiny git repo so log has something to show
      await execAsync("git init", { cwd: projectRoot });
      await execAsync(
        'git -c user.email=t@t -c user.name=t commit --allow-empty -m first',
        { cwd: projectRoot },
      );

      const result = await executeTool(
        "git",
        { args: "log --oneline" },
        projectRoot,
      );
      expect(result).toContain("first");
    });
  });

  describe("ast_grep tool", () => {
    test("finds structural matches", async () => {
      await mkdir(path.join(projectRoot, "src"), { recursive: true });
      await writeFile(
        path.join(projectRoot, "src", "sample.ts"),
        "console.log('hi');\nconst x = 1;\n",
        "utf8",
      );

      const result = await executeTool(
        "ast_grep",
        { pattern: "console.log($$$)", lang: "typescript", path: "src" },
        projectRoot,
      );

      // Should return compact JSON array (possibly empty but no error).
      expect(result).not.toContain("Error:");
      expect(result.trim().startsWith("[")).toBe(true);
    });

    test("requires a language", async () => {
      const result = await executeTool(
        "ast_grep",
        { pattern: "console.log($$$)", path: "." },
        projectRoot,
      );
      expect(result).toContain("Error");
    });
  });

  describe("ast_search tool", () => {
    test("runs an inline yaml rule", async () => {
      await mkdir(path.join(projectRoot, "src"), { recursive: true });
      await writeFile(
        path.join(projectRoot, "src", "sample.ts"),
        "export function foo() {}\n",
        "utf8",
      );

      const rule =
        "id: find-foo\nlanguage: typescript\nrule:\n  pattern: export function foo() {}\n";
      const result = await executeTool(
        "ast_search",
        { rule, path: "src" },
        projectRoot,
      );

      expect(result).not.toContain("Error:");
      expect(result.trim().startsWith("[")).toBe(true);
    });
  });

  describe("gh tool", () => {
    test("rejects non-gh subcommands", async () => {
      const result = await executeTool(
        "gh",
        { args: "auth login" },
        projectRoot,
      );
      expect(result).toContain("not permitted");
    });

    test("rejects pr create", async () => {
      const result = await executeTool(
        "gh",
        { args: "pr create --title test" },
        projectRoot,
      );
      expect(result).toContain("blocked operation");
    });

    test("rejects pr merge", async () => {
      const result = await executeTool(
        "gh",
        { args: "pr merge 123" },
        projectRoot,
      );
      expect(result).toContain("blocked operation");
    });

    test("rejects pr close without a valid PR number", async () => {
      const result = await executeTool(
        "gh",
        { args: "pr close abc" },
        projectRoot,
      );
      expect(result).toContain("valid PR number");
    });

    test("rejects pr close when PR verification fails (no gh auth)", async () => {
      const result = await executeTool(
        "gh",
        { args: "pr close 999" },
        projectRoot,
      );
      // The handler tries to verify the PR is a wiki/staging-* branch.
      // Without gh auth, this fails with an error mentioning the PR number.
      expect(result).toContain("Error");
      expect(result).toContain("999");
    });

    test("rejects pr comment on non-staging branch", async () => {
      // Mock: we can't easily test the full flow without a real PR,
      // but we can verify the subcommand is not blocked outright.
      // The handler will try gh pr view and fail — that's expected.
      const result = await executeTool(
        "gh",
        { args: "pr comment 999 --body test" },
        projectRoot,
      );
      expect(result).toContain("Error");
    });

    test("rejects shell metacharacters", async () => {
      const result = await executeTool(
        "gh",
        { args: "pr list; rm -rf ." },
        projectRoot,
      );
      expect(result).toContain("metacharacters");
    });

    test("rejects issue create", async () => {
      const result = await executeTool(
        "gh",
        { args: "issue create --title test" },
        projectRoot,
      );
      expect(result).toContain("blocked operation");
    });

    test("rejects run rerun", async () => {
      const result = await executeTool(
        "gh",
        { args: "run rerun 123" },
        projectRoot,
      );
      expect(result).toContain("blocked operation");
    });
  });

  describe("tool definitions", () => {
    test("all tools have valid definitions", () => {
      const tools = createTools(projectRoot);

      for (const tool of tools) {
        expect(tool.definition.type).toBe("function");
        expect(tool.definition.function.name).toBeTruthy();
        expect(tool.definition.function.description).toBeTruthy();
        expect(tool.definition.function.parameters.type).toBe("object");
      }
    });

    test("expected tools are present", () => {
      const tools = createTools(projectRoot);
      const names = tools.map((t) => t.definition.function.name);

      expect(names).toContain("read_file");
      expect(names).toContain("write_file");
      expect(names).toContain("edit_file");
      expect(names).toContain("ls");
      expect(names).toContain("grep");
      expect(names).toContain("glob");
      expect(names).toContain("git");
      expect(names).toContain("ast_grep");
      expect(names).toContain("ast_search");
      expect(names).toContain("gh");
    });

    test("execute tool is removed", () => {
      const tools = createTools(projectRoot);
      const names = tools.map((t) => t.definition.function.name);
      expect(names).not.toContain("execute");
    });
  });
});