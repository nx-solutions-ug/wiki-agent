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

  test("index entries are deterministically sorted and complete across chunk boundaries", async () => {
    // More than CHUNK_SIZE (16) files so the parallel sync spans multiple
    // chunks. Names are reverse-sorted relative to filesystem insertion order,
    // so a non-sorting implementation would emit them out of order.
    const FILE_COUNT = 24;
    const makeName = (i: number) => String.fromCharCode(122 - i) + "-file.md";
    const makeContent = (name: string) =>
      "---\ntitle: " + name[0].toUpperCase() + " Title\n---\n# Content\n";
    const expectedNames = Array.from({ length: FILE_COUNT }, (_, i) =>
      makeName(i)
    ).sort((a, b) => a.localeCompare(b));


    // Run repeatedly — concurrency scheduling is non-deterministic, so a
    // shared-array ordering bug could pass once but not reliably.
    for (let run = 0; run < 5; run++) {
      const dir = await tempDir();
      for (let i = 0; i < FILE_COUNT; i++) {
        const name = makeName(i);
        await writeFile(path.join(dir, name), makeContent(name), "utf8");
      }

      await synchronizeWikiIndexes(dir);

      const index = await readFile(path.join(dir, "index.md"), "utf8");
      const linkOrder: string[] = [];
      for (const line of index.split("\n")) {
        const match = line.match(/- \[(.*?)\]\((.*?)\)/);
        if (match) linkOrder.push(match[2]);
      }

      // Output must be fully sorted and contain every file — no drops.
      expect(linkOrder).toEqual(expectedNames);
      expect(linkOrder.length).toBe(FILE_COUNT);

      await rm(dir, { recursive: true, force: true });
    }
  });

  test("rejects when a file has invalid frontmatter instead of silently dropping it", async () => {
    await writeWikiFile(
      wikiRoot,
      "good.md",
      "---\ntitle: Good\n---\n# Good\n"
    );
    await writeWikiFile(
      wikiRoot,
      "bad.md",
      "---\ntitle: [this is not, a valid scalar\n---\n# Bad\n"
    );

    await expect(synchronizeWikiIndexes(wikiRoot)).rejects.toThrow(/invalid YAML front matter/);
  });
});
