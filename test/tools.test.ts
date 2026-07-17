import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTools, executeTool } from "../src/tools.ts";

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

  describe("execute self-invocation guard", () => {
    test("blocks wiki command", async () => {
      const result = await executeTool(
        "execute",
        { command: "wiki --update --print" },
        projectRoot,
      );
      expect(result).toContain("blocked");
    });

    test("blocks wiki-agent path", async () => {
      const result = await executeTool(
        "execute",
        { command: "node /tmp/wiki-agent/dist/cli.js --init" },
        projectRoot,
      );
      expect(result).toContain("blocked");
    });

    test("blocks dist/cli.js invocation", async () => {
      const result = await executeTool(
        "execute",
        { command: "node dist/cli.js --update" },
        projectRoot,
      );
      expect(result).toContain("blocked");
    });

    test("allows non-wiki commands", async () => {
      const result = await executeTool(
        "execute",
        { command: "echo hello" },
        projectRoot,
      );
      expect(result).toContain("hello");
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
      expect(names).toContain("execute");
    });
  });
});