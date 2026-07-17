import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { synchronizeWikiIndexes } from "../src/index-middleware.ts";

function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "wiki-index-test-"));
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

describe("index-middleware", () => {
  let wikiRoot: string;

  beforeEach(async () => {
    wikiRoot = await tempDir();
    await mkdir(wikiRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(wikiRoot, { recursive: true, force: true });
  });

  test("creates index.md for directory with frontmattered files", async () => {
    await writeWikiFile(
      wikiRoot,
      "quickstart.md",
      "---\ntype: Quickstart\ntitle: Getting Started\ndescription: How to get started.\n---\n\n# Getting Started\n",
    );
    await writeWikiFile(
      wikiRoot,
      "architecture.md",
      "---\ntype: Reference\ntitle: Architecture\ndescription: System architecture.\n---\n\n# Architecture\n",
    );

    await synchronizeWikiIndexes(wikiRoot);

    const index = await readFile(path.join(wikiRoot, "index.md"), "utf8");
    expect(index).toContain("Getting Started");
    expect(index).toContain("Architecture");
    expect(index).toContain("How to get started.");
    expect(index).toContain("System architecture.");
  });

  test("indexes a file without frontmatter using its filename", async () => {
    await writeWikiFile(wikiRoot, "api.md", "# API Reference\n\nContent.\n");

    await synchronizeWikiIndexes(wikiRoot);

    const index = await readFile(path.join(wikiRoot, "index.md"), "utf8");
    expect(index).toContain("- [api](api.md)");
    expect(index).not.toContain("undefined");
  });

  test("does not rewrite an index that is already current", async () => {
    await writeWikiFile(
      wikiRoot,
      "page.md",
      "---\ntype: Reference\ntitle: Page\ndescription: A page.\n---\n\n# Page\n",
    );

    await synchronizeWikiIndexes(wikiRoot);
    const firstIndex = await readFile(path.join(wikiRoot, "index.md"), "utf8");

    await synchronizeWikiIndexes(wikiRoot);
    const secondIndex = await readFile(path.join(wikiRoot, "index.md"), "utf8");

    expect(secondIndex).toBe(firstIndex);
  });

  test("excludes index.md and _plan.md from listings", async () => {
    await writeWikiFile(
      wikiRoot,
      "page.md",
      "---\ntype: Reference\ntitle: Page\ndescription: A page.\n---\n\n# Page\n",
    );
    await writeWikiFile(wikiRoot, "_plan.md", "# Plan");
    await writeWikiFile(wikiRoot, "index.md", "# Existing index");

    await synchronizeWikiIndexes(wikiRoot);

    const index = await readFile(path.join(wikiRoot, "index.md"), "utf8");
    expect(index).toContain("Page");
    expect(index).not.toContain("_plan.md");
    expect(index).not.toContain("[index]");
  });

  test("indexes subdirectories", async () => {
    await writeWikiFile(
      wikiRoot,
      "architecture/overview.md",
      "---\ntype: Reference\ntitle: Overview\ndescription: Overview.\n---\n\n# Overview\n",
    );

    await synchronizeWikiIndexes(wikiRoot);

    const rootIndex = await readFile(path.join(wikiRoot, "index.md"), "utf8");
    expect(rootIndex).toContain("architecture/");

    const subIndex = await readFile(
      path.join(wikiRoot, "architecture", "index.md"),
      "utf8",
    );
    expect(subIndex).toContain("Overview");
  });

  test("handles empty wiki directory gracefully", async () => {
    await synchronizeWikiIndexes(wikiRoot);

    const index = await readFile(path.join(wikiRoot, "index.md"), "utf8");
    expect(index).toContain("Wiki");
  });

  test("handles non-existent wiki directory gracefully", async () => {
    const nonExistent = path.join(os.tmpdir(), "nonexistent-wiki-" + Date.now());
    await synchronizeWikiIndexes(nonExistent);
    // Should not throw
  });
});