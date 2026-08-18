import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import {
  generateUpdateReport,
  generateUpdateTitle,
  filterReportFiles,
  WIKI_GITIGNORE,
  untrackRunMetadataFiles,
  appendWikiAgentFrontmatter,
} from "../src/agent.ts";

const execFileAsync = promisify(execFile);

describe("generateUpdateReport", () => {
  test("empty changedFiles produces no-op report", () => {
    const report = generateUpdateReport("update", []);
    expect(report).toContain("# Wiki Updated");
    expect(report).toContain("No files were changed");
  });

  test("init command uses 'Initialized' label", () => {
    const report = generateUpdateReport("init", []);
    expect(report).toContain("# Wiki Initialized");
  });

  test("created files are listed under New pages", () => {
    const report = generateUpdateReport("update", [
      { action: "created", path: ".wiki/quickstart.md", description: "" },
    ]);
    expect(report).toContain("## New pages");
    expect(report).toContain(".wiki/quickstart.md");
    expect(report).not.toContain("## Updated pages");
  });

  test("edited files are listed under Updated pages", () => {
    const report = generateUpdateReport("update", [
      { action: "edited", path: ".wiki/architecture.md", description: "" },
    ]);
    expect(report).toContain("## Updated pages");
    expect(report).toContain(".wiki/architecture.md");
    expect(report).not.toContain("## New pages");
  });

  test("descriptions are rendered as blockquotes under each file", () => {
    const report = generateUpdateReport("update", [
      {
        action: "edited",
        path: ".wiki/cli/usage.md",
        description:
          "Revised the --print section after the headless output refactor in cli.tsx changed how events are emitted.",
      },
    ]);
    expect(report).toContain(".wiki/cli/usage.md");
    expect(report).toContain("Revised the --print section");
    expect(report).toContain(">"); // blockquote marker
  });

  test("missing description does not produce a blockquote", () => {
    const report = generateUpdateReport("update", [
      { action: "edited", path: ".wiki/cli/usage.md" },
    ]);
    expect(report).toContain(".wiki/cli/usage.md");
    // No description provided — should not render a blockquote line
    const lines = report.split("\n");
    const fileLineIdx = lines.findIndex((l) => l.includes(".wiki/cli/usage.md"));
    const following = lines.slice(fileLineIdx + 1, fileLineIdx + 3).join("\n");
    expect(following).not.toContain(">");
  });

  test("long descriptions are truncated", () => {
    const long = "A".repeat(800);
    const report = generateUpdateReport("update", [
      { action: "created", path: ".wiki/big.md", description: long },
    ]);
    expect(report).toContain("…");
    // Should not contain the full 800-char string
    expect(report).not.toContain(long);
  });

  test("whitespace in descriptions is collapsed", () => {
    const report = generateUpdateReport("update", [
      {
        action: "edited",
        path: ".wiki/x.md",
        description: "Added\n  newlines\t  and   extra   spaces",
      },
    ]);
    expect(report).toContain("Added newlines and extra spaces");
  });

  test("summary counts both created and edited", () => {
    const report = generateUpdateReport("update", [
      { action: "created", path: ".wiki/a.md", description: "" },
      { action: "created", path: ".wiki/b.md", description: "" },
      { action: "edited", path: ".wiki/c.md", description: "" },
    ]);
    expect(report).toContain("created 2 pages");
    expect(report).toContain("edited 1 page");
  });
});

describe("generateUpdateTitle", () => {
  test("no changes produces a generic docs title", () => {
    expect(generateUpdateTitle("update", [])).toBe("docs: update wiki");
  });

  test("init command uses initialize label", () => {
    expect(generateUpdateTitle("init", [])).toBe("docs: initialize wiki");
  });

  test("only created pages are reflected", () => {
    expect(
      generateUpdateTitle("update", [
        { action: "created", path: ".wiki/a.md", description: "" },
      ]),
    ).toBe("docs: update wiki (1 new page)");
  });

  test("created pages pluralize", () => {
    expect(
      generateUpdateTitle("update", [
        { action: "created", path: ".wiki/a.md", description: "" },
        { action: "created", path: ".wiki/b.md", description: "" },
      ]),
    ).toBe("docs: update wiki (2 new pages)");
  });

  test("only edited pages are reflected", () => {
    expect(
      generateUpdateTitle("update", [
        { action: "edited", path: ".wiki/a.md", description: "" },
      ]),
    ).toBe("docs: update wiki (1 updated page)");
  });

  test("edited pages pluralize", () => {
    expect(
      generateUpdateTitle("update", [
        { action: "edited", path: ".wiki/a.md", description: "" },
        { action: "edited", path: ".wiki/b.md", description: "" },
      ]),
    ).toBe("docs: update wiki (2 updated pages)");
  });

  test("both created and edited are combined", () => {
    expect(
      generateUpdateTitle("update", [
        { action: "created", path: ".wiki/a.md", description: "" },
        { action: "created", path: ".wiki/b.md", description: "" },
        { action: "edited", path: ".wiki/c.md", description: "" },
      ]),
    ).toBe("docs: update wiki (2 new pages, 1 updated page)");
  });

  test("init with changes uses initialize label", () => {
    expect(
      generateUpdateTitle("init", [
        { action: "created", path: ".wiki/a.md", description: "" },
      ]),
    ).toBe("docs: initialize wiki (1 new page)");
  });
});
describe("filterReportFiles", () => {
  test("excludes run metadata files", () => {
    const input = [
      { action: "created", path: ".wiki/quickstart.md", description: "Wrote .wiki/quickstart.md" },
      { action: "created", path: ".wiki/.last-updated.json", description: "Wrote .wiki/.last-updated.json" },
      { action: "created", path: ".wiki/.last-update-report.md", description: "Wrote .wiki/.last-update-report.md" },
      { action: "created", path: ".wiki/.last-update-title.txt", description: "Wrote .wiki/.last-update-title.txt" },
    ];
    const filtered = filterReportFiles(input);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].path).toBe(".wiki/quickstart.md");
  });

  test("deduplicates entries by path keeping the first occurrence", () => {
    const input = [
      { action: "created", path: ".wiki/doc.md", description: "Wrote first" },
      { action: "edited", path: ".wiki/doc.md", description: "Edited second" },
    ];
    const filtered = filterReportFiles(input);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].description).toBe("Wrote first");
  });
});

describe("WIKI_GITIGNORE", () => {
  test("contains entries for all run metadata files", () => {
    expect(WIKI_GITIGNORE).toContain("/.last-updated.json");
    expect(WIKI_GITIGNORE).toContain("/.last-update-report.md");
    expect(WIKI_GITIGNORE).toContain("/.last-update-title.txt");
  });

  test("contains entries for SQLite database and sidecar files", () => {
    expect(WIKI_GITIGNORE).toContain("/wiki.db");
    expect(WIKI_GITIGNORE).toContain("/wiki.db-journal");
    expect(WIKI_GITIGNORE).toContain("/wiki.db-wal");
    expect(WIKI_GITIGNORE).toContain("/wiki.db-shm");
  });
});

describe("untrackRunMetadataFiles", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "wiki-untrack-test-"));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  test("untracks metadata files when tracked in git", async () => {
    await execFileAsync("git", ["init"], { cwd: projectRoot });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: projectRoot });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: projectRoot });

    const wikiDir = path.join(projectRoot, ".wiki");
    await mkdir(wikiDir, { recursive: true });
    const metaFile = path.join(wikiDir, ".last-updated.json");
    await writeFile(metaFile, "{}\n", "utf8");

    await execFileAsync("git", ["add", ".wiki/.last-updated.json"], { cwd: projectRoot });
    await execFileAsync("git", ["commit", "-m", "initial commit"], { cwd: projectRoot });

    const untracked = await untrackRunMetadataFiles(projectRoot);
    expect(untracked).toContain(path.join(".wiki", ".last-updated.json"));

    const { stdout } = await execFileAsync("git", ["ls-files", ".wiki/.last-updated.json"], { cwd: projectRoot });
    expect(stdout.trim()).toBe("");
  });
});
describe("appendWikiAgentFrontmatter", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(path.join(os.tmpdir(), "wiki-frontmatter-test-"));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  test("creates AGENTS.md when neither file exists", async () => {
    const result = await appendWikiAgentFrontmatter(projectRoot);
    expect(result).toEqual({ file: "AGENTS.md", action: "created" });
    const content = await readFile(path.join(projectRoot, "AGENTS.md"), "utf8");
    expect(content).toContain("<!-- wiki-agent -->");
    expect(content).toContain("## Wiki Agent");
    expect(content).toContain("version:");
  });

  test("appends to existing AGENTS.md without prepending", async () => {
    const agentsPath = path.join(projectRoot, "AGENTS.md");
    await writeFile(agentsPath, "# My Project\n\nSome existing content.\n", "utf8");
    const result = await appendWikiAgentFrontmatter(projectRoot);
    expect(result).toEqual({ file: "AGENTS.md", action: "appended" });
    const content = await readFile(agentsPath, "utf8");
    expect(content.startsWith("# My Project")).toBe(true);
    expect(content).toContain("Some existing content.");
    expect(content).toContain("<!-- wiki-agent -->");
    const markerIdx = content.indexOf("<!-- wiki-agent -->");
    const existingIdx = content.indexOf("Some existing content.");
    expect(markerIdx).toBeGreaterThan(existingIdx);
  });

  test("refreshes existing wiki-agent section idempotently", async () => {
    const agentsPath = path.join(projectRoot, "AGENTS.md");
    const first = await appendWikiAgentFrontmatter(projectRoot);
    expect(first?.action).toBe("created");
    const firstContent = await readFile(agentsPath, "utf8");
    const second = await appendWikiAgentFrontmatter(projectRoot);
    expect(second).toEqual({ file: "AGENTS.md", action: "refreshed" });
    const secondContent = await readFile(agentsPath, "utf8");
    const markerCount = secondContent.split("<!-- wiki-agent -->").length - 1;
    expect(markerCount).toBe(1);
    expect(secondContent.length).toBeLessThan(firstContent.length * 2);
  });

  test("prefers AGENTS.md over CLAUDE.md", async () => {
    await writeFile(path.join(projectRoot, "AGENTS.md"), "# Agents\n", "utf8");
    await writeFile(path.join(projectRoot, "CLAUDE.md"), "# Claude\n", "utf8");
    const result = await appendWikiAgentFrontmatter(projectRoot);
    expect(result?.file).toBe("AGENTS.md");
    const claudeContent = await readFile(path.join(projectRoot, "CLAUDE.md"), "utf8");
    expect(claudeContent).not.toContain("<!-- wiki-agent -->");
  });

  test("uses CLAUDE.md when AGENTS.md is absent", async () => {
    await writeFile(path.join(projectRoot, "CLAUDE.md"), "# Claude\n", "utf8");
    const result = await appendWikiAgentFrontmatter(projectRoot);
    expect(result?.file).toBe("CLAUDE.md");
    const content = await readFile(path.join(projectRoot, "CLAUDE.md"), "utf8");
    expect(content).toContain("<!-- wiki-agent -->");
  });

  test("handles file without trailing newline", async () => {
    const agentsPath = path.join(projectRoot, "AGENTS.md");
    await writeFile(agentsPath, "# No trailing newline", "utf8");
    const result = await appendWikiAgentFrontmatter(projectRoot);
    expect(result?.action).toBe("appended");
    const content = await readFile(agentsPath, "utf8");
    expect(content).toContain("# No trailing newline\n");
    expect(content).toContain("<!-- wiki-agent -->");
  });
});