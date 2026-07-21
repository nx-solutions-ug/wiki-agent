import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { flattenWiki } from "../src/flatten-wiki.ts";

function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "wiki-flatten-test-"));
}

async function writeWikiFile(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const fullPath = path.join(root, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, "utf8");
}

describe("flatten-wiki", () => {
  let wikiRoot: string;
  let outputDir: string;

  beforeEach(async () => {
    wikiRoot = await tempDir();
    outputDir = await tempDir();
  });

  afterEach(async () => {
    await Promise.all([
      rm(wikiRoot, { recursive: true, force: true }),
      rm(outputDir, { recursive: true, force: true }),
    ]);
  });

  test("strips YAML frontmatter from page body (GitHub Wiki renders it as text)", async () => {
    await writeWikiFile(
      wikiRoot,
      "configuration.md",
      [
        "---",
        "type: Reference",
        "title: Configuration",
        "description: Config resolution docs.",
        "tags: [config]",
        "---",
        "# Configuration",
        "",
        "Wiki Agent merges configuration from several sources.",
        "",
      ].join("\n"),
    );

    await flattenWiki(wikiRoot, outputDir);

    const out = await readFile(path.join(outputDir, "Configuration.md"), "utf8");
    // Frontmatter block must be gone — no leading --- fence and no raw keys
    expect(out.startsWith("---")).toBe(false);
    expect(out).not.toContain("type: Reference");
    expect(out).not.toContain("tags: [config]");
    // Body content is preserved
    expect(out).toContain("# Configuration");
    expect(out).toContain("Wiki Agent merges configuration");
  });

  test("uses frontmatter title for the sidebar even though it is stripped from body", async () => {
    await writeWikiFile(
      wikiRoot,
      "quickstart.md",
      [
        "---",
        "title: Getting Started",
        "---",
        "# Getting Started",
        "",
        "Quick intro.",
        "",
      ].join("\n"),
    );

    await flattenWiki(wikiRoot, outputDir);

    const sidebar = await readFile(path.join(outputDir, "_Sidebar.md"), "utf8");
    expect(sidebar).toContain("[Getting Started](Quickstart)");
    // Body should not contain the frontmatter
    const body = await readFile(path.join(outputDir, "Quickstart.md"), "utf8");
    expect(body.startsWith("---")).toBe(false);
    expect(body).not.toContain("title: Getting Started");
  });

  test("leaves files without frontmatter unchanged", async () => {
    const content = "# Plain Page\n\nNo frontmatter here.\n";
    await writeWikiFile(wikiRoot, "plain.md", content);

    await flattenWiki(wikiRoot, outputDir);

    const out = await readFile(path.join(outputDir, "Plain.md"), "utf8");
    expect(out).toBe(content);
  });

  test("flattens nested paths to dash-joined filenames and strips frontmatter", async () => {
    await writeWikiFile(
      wikiRoot,
      "cli/usage.md",
      "---\ntitle: CLI Usage\n---\n# CLI Usage\n\nDetails.\n",
    );

    await flattenWiki(wikiRoot, outputDir);

    const out = await readFile(path.join(outputDir, "Cli-Usage.md"), "utf8");
    expect(out.startsWith("---")).toBe(false);
    expect(out).toContain("# CLI Usage");
  });
});