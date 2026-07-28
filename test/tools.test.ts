import { describe, expect, test, beforeEach, afterEach, beforeAll } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { createTools, executeTool, parseArgsStringToArgv, stripThinkingTags } from "../src/tools.ts";

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

  describe("thinking tag stripping", () => {
    // Build tags from char codes so the literal angle brackets survive
    // tooling and reach the assertions intact.
    const LT = String.fromCharCode(60);
    const GT = String.fromCharCode(62);
    const think = (body: string) => `${LT}think${GT}${body}${LT}/think${GT}`;
    const thinking = (body: string) => `${LT}thinking${GT}${body}${LT}/thinking${GT}`;
    const reasoning = (body: string) => `${LT}reasoning${GT}${body}${LT}/reasoning${GT}`;
    const reflection = (body: string) => `${LT}reflection${GT}${body}${LT}/reflection${GT}`;

    test("write_file strips think blocks from content", async () => {
      const result = await executeTool(
        "write_file",
        {
          path: ".wiki/quickstart.md",
          content: `${think("Let me plan the doc.")}\n---\ntype: Guide\ntitle: Quickstart\n---\n# Quickstart\n`,
        },
        projectRoot,
      );

      expect(result).toBe("Wrote .wiki/quickstart.md");

      const content = await readFile(
        path.join(projectRoot, ".wiki", "quickstart.md"),
        "utf8",
      );
      expect(content).not.toContain(`${LT}think`);
      expect(content).not.toContain("Let me plan the doc");
      expect(content).toContain("---\ntype: Guide\ntitle: Quickstart\n---");
      expect(content).toContain("# Quickstart");
    });

    test("write_file strips thinking blocks", async () => {
      await executeTool(
        "write_file",
        {
          path: ".wiki/arch.md",
          content: `${thinking("I need to describe the architecture.")}\n# Architecture\n`,
        },
        projectRoot,
      );

      const content = await readFile(
        path.join(projectRoot, ".wiki", "arch.md"),
        "utf8",
      );
      expect(content).not.toContain(`${LT}thinking`);
      expect(content).not.toContain("I need to describe");
      expect(content).toContain("# Architecture");
    });

    test("write_file strips reasoning and reflection blocks", async () => {
      await executeTool(
        "write_file",
        {
          path: ".wiki/cli.md",
          content: `${reasoning("r1")}\nmid\n${reflection("r2")}\n# CLI\n`,
        },
        projectRoot,
      );

      const content = await readFile(
        path.join(projectRoot, ".wiki", "cli.md"),
        "utf8",
      );
      expect(content).not.toContain(`${LT}reasoning`);
      expect(content).not.toContain(`${LT}reflection`);
      expect(content).not.toContain("r1");
      expect(content).not.toContain("r2");
      expect(content).toContain("mid");
      expect(content).toContain("# CLI");
    });

    test("write_file strips thinking tags spanning multiple lines", async () => {
      await executeTool(
        "write_file",
        {
          path: ".wiki/multi.md",
          content: `${think("Line one\nLine two\nLine three")}\n\n# Multi\n`,
        },
        projectRoot,
      );

      const content = await readFile(
        path.join(projectRoot, ".wiki", "multi.md"),
        "utf8",
      );
      expect(content).not.toContain(`${LT}think`);
      expect(content).not.toContain("Line one");
      expect(content).not.toContain("Line two");
      expect(content).not.toContain("Line three");
      expect(content).toContain("# Multi");
    });

    test("write_file leaves content without thinking tags unchanged", async () => {
      await executeTool(
        "write_file",
        {
          path: ".wiki/clean.md",
          content: "---\ntype: Guide\ntitle: Clean\n---\n# Clean\n\nNo thinking here.\n",
        },
        projectRoot,
      );

      const content = await readFile(
        path.join(projectRoot, ".wiki", "clean.md"),
        "utf8",
      );
      expect(content).toBe(
        "---\ntype: Guide\ntitle: Clean\n---\n# Clean\n\nNo thinking here.\n",
      );
    });

    test("edit_file strips thinking tags from new_string", async () => {
      await executeTool(
        "write_file",
        { path: ".wiki/edit.md", content: "# Title\n\nold section\n" },
        projectRoot,
      );

      const result = await executeTool(
        "edit_file",
        {
          path: ".wiki/edit.md",
          old_string: "old section",
          new_string: `${think("Plan the new section.")}\nnew section`,
        },
        projectRoot,
      );

      expect(result).toBe("Edited .wiki/edit.md");

      const content = await readFile(
        path.join(projectRoot, ".wiki", "edit.md"),
        "utf8",
      );
      expect(content).not.toContain(`${LT}think`);
      expect(content).not.toContain("Plan the new section");
      expect(content).toContain("new section");
      expect(content).toContain("# Title");
    });

    test("stripThinkingTags removes all known tag variants and trims leading whitespace", () => {
      const input = `${think("Plan.")}\n${thinking("thk")}\n${reasoning("rsn")}\n${reflection("rfl")}\n# Title\n`;
      const stripped = stripThinkingTags(input);
      expect(stripped).not.toContain(`${LT}think`);
      expect(stripped).not.toContain(`${LT}thinking`);
      expect(stripped).not.toContain(`${LT}reasoning`);
      expect(stripped).not.toContain(`${LT}reflection`);
      expect(stripped).not.toContain("Plan.");
      expect(stripped).not.toContain("thk");
      expect(stripped).toContain("# Title");
      // Leading whitespace from the removed leading block is trimmed
      expect(stripped.startsWith("#")).toBe(true);
    });

    test("stripThinkingTags returns content unchanged when no tags present", () => {
      const input = "---\ntitle: X\n---\n# X\n";
      expect(stripThinkingTags(input)).toBe(input);
    });

    test("stripThinkingTags short-circuits on content with no angle bracket", () => {
      const input = "plain text no tags here";
      expect(stripThinkingTags(input)).toBe(input);
    });

    test("stripThinkingTags is case-insensitive for uppercase tags", () => {
      const LT = String.fromCharCode(60);
      const upper = `${LT}THINK${GT}planning${LT}/THINK${GT}\n# Title\n`;
      const mixed = `${LT}Thinking${GT}thk${LT}/THINKING${GT}\n# Title\n`;
      expect(stripThinkingTags(upper)).toBe("# Title\n");
      expect(stripThinkingTags(mixed)).toBe("# Title\n");
    });

    test("stripThinkingTags removes nested same-tag blocks and orphaned tags", () => {
      const LT = String.fromCharCode(60);
      const GT = String.fromCharCode(62);
      const open = `${LT}think${GT}`;
      const close = `${LT}/think${GT}`;
      // Nested same-tag blocks: no current model emits these, but the
      // orphan-cleanup pass should at least strip the leftover closing tag.
      const nested = `${open}outer${open}inner${close}tail${close}\n# Title\n`;
      const stripped = stripThinkingTags(nested);
      // No think tags should remain (orphaned closing tag is cleaned up)
      expect(stripped).not.toContain(`${LT}think`);
      expect(stripped).not.toContain("outer");
      expect(stripped).not.toContain("inner");
      // The matched inner pair is removed; the orphaned outer closing tag is
      // removed. Content between the two closing tags ("tail") may persist
      // since it was outside the matched pair — acceptable for a case no real
      // model produces.
      expect(stripped).toContain("# Title");
    });

    test("stripThinkingTags strips orphaned mismatched tags but preserves body", () => {
      const LT = String.fromCharCode(60);
      const GT = String.fromCharCode(62);
      //  opened, </thinking> closed — backreference prevents a pair
      // match, so the body is NOT consumed as thinking content. The orphan
      // cleanup then strips the unmatched tags themselves, leaving the body.
      const mismatched = `${LT}think${GT}body${LT}/thinking${GT}\n# Title\n`;
      const stripped = stripThinkingTags(mismatched);
      expect(stripped).not.toContain(`${LT}think`);
      expect(stripped).not.toContain(`${LT}/thinking`);
      // Body content survives — it was not inside a matched pair
      expect(stripped).toContain("body");
      expect(stripped).toContain("# Title");
    });

    test("stripThinkingTags tolerates attributes on the opening tag", () => {
      const LT = String.fromCharCode(60);
      const GT = String.fromCharCode(62);
      const withAttr = `${LT}think type="reasoning"${GT}body${LT}/think${GT}\n# Title\n`;
      const stripped = stripThinkingTags(withAttr);
      expect(stripped).toBe("# Title\n");
    });
  });

  describe("git tool", () => {
    beforeEach(async () => {
      await execAsync("git init && git -c user.email=t@t -c user.name=t commit --allow-empty -m first", { cwd: projectRoot });
    });

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

    test("rejects git config injection via shell evaluation", async () => {
      const result = await executeTool(
        "git",
        { args: "-c core.pager=!echo\\ vulnerable log -1" },
        projectRoot,
      );
      expect(result).not.toContain("vulnerable");
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

    test("rejects command injection via shell evaluation in gh tool", async () => {
      const result = await executeTool(
        "gh",
        { args: "pr list --search \"`echo vulnerable`\"" },
        projectRoot,
      );
      expect(result).not.toContain("vulnerable");
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

  describe("grep tool", () => {
    test("prevents command injection via pattern", async () => {
      await writeFile(path.join(projectRoot, "test.md"), "some content\n");
      const result = await executeTool(
        "grep",
        { pattern: "'; echo 'vulnerable" },
        projectRoot,
      );
      expect(result).not.toContain("vulnerable");
    });

    test("prevents command injection via path", async () => {
      await writeFile(path.join(projectRoot, "test.md"), "some content\n");
      const result = await executeTool(
        "grep",
        { pattern: "some", path: ".; echo 'vulnerable #" },
        projectRoot,
      );
      expect(result).not.toContain("vulnerable");
    });

    test("searches for a pattern and returns matches", async () => {
      await writeFile(path.join(projectRoot, "test.md"), "hello world\nfoo bar\n");
      const result = await executeTool(
        "grep",
        { pattern: "hello" },
        projectRoot,
      );
      expect(result).toContain("hello world");
    });
  });

  describe("glob tool", () => {
    test("prevents command injection", async () => {
      const result = await executeTool(
        "glob",
        { pattern: "'; echo 'vulnerable" },
        projectRoot,
      );
      expect(result).not.toContain("vulnerable");
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

describe("parseArgsStringToArgv", () => {
  test("handles empty string", () => {
    expect(parseArgsStringToArgv("")).toEqual([]);
  });

  test("handles simple spaces", () => {
    expect(parseArgsStringToArgv("foo bar baz")).toEqual(["foo", "bar", "baz"]);
  });

  test("handles multiple spaces", () => {
    expect(parseArgsStringToArgv("  foo   bar  ")).toEqual(["foo", "bar"]);
  });

  test("handles single quotes", () => {
    expect(parseArgsStringToArgv("foo 'bar baz' qux")).toEqual(["foo", "bar baz", "qux"]);
  });

  test("handles double quotes", () => {
    expect(parseArgsStringToArgv('foo "bar baz" qux')).toEqual(["foo", "bar baz", "qux"]);
  });

  test("handles escaped characters", () => {
    expect(parseArgsStringToArgv("foo \\bar baz")).toEqual(["foo", "bar", "baz"]);
  });

  test("handles quotes inside quotes", () => {
    expect(parseArgsStringToArgv("foo '\"bar\"' \"'baz'\"")).toEqual(["foo", "\"bar\"", "'baz'"]);
  });
});
