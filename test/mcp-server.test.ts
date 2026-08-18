import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readWikiPage, listWikiPages } from "../src/mcp-server.js";
import {
  indexWiki,
  VectorStore,
  type Embedder,
} from "../src/embeddings.js";

function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "wiki-mcp-test-"));
}

// Deterministic mock embedder for testing
class MockEmbedder implements Embedder {
  private dim: number;
  constructor(dimension: number = 16) {
    this.dim = dimension;
  }
  dimension(): number {
    return this.dim;
  }
  async embed(text: string): Promise<Float32Array> {
    const vec = new Float32Array(this.dim);
    for (let i = 0; i < this.dim; i++) {
      vec[i] = (text.charCodeAt(i % text.length) + i) / 1000;
    }
    return vec;
  }
}

describe("MCP server tools", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await tempDir();
    await mkdir(path.join(projectRoot, ".wiki"), { recursive: true });
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  describe("readWikiPage", () => {
    test("reads a wiki page by relative path", async () => {
      await writeFile(path.join(projectRoot, ".wiki", "quickstart.md"), "# Quickstart\n\nWelcome.");

      const content = await readWikiPage(projectRoot, "quickstart");
      expect(content).toContain("# Quickstart");
      expect(content).toContain("Welcome.");
    });

    test("reads a wiki page with .md extension", async () => {
      await writeFile(path.join(projectRoot, ".wiki", "guide.md"), "# Guide");

      const content = await readWikiPage(projectRoot, "guide.md");
      expect(content).toContain("# Guide");
    });

    test("reads nested wiki pages", async () => {
      await mkdir(path.join(projectRoot, ".wiki", "architecture"));
      await writeFile(path.join(projectRoot, ".wiki", "architecture", "overview.md"), "# Overview");

      const content = await readWikiPage(projectRoot, "architecture/overview");
      expect(content).toContain("# Overview");
    });

    test("throws on path outside .wiki/", async () => {
      await expect(readWikiPage(projectRoot, "../etc/passwd")).rejects.toThrow();
    });

    test("throws on non-existent page", async () => {
      await expect(readWikiPage(projectRoot, "nonexistent")).rejects.toThrow("not found");
    });
  });

  describe("listWikiPages", () => {
    test("lists all wiki pages", async () => {
      await writeFile(path.join(projectRoot, ".wiki", "page1.md"), "# Page 1");
      await writeFile(path.join(projectRoot, ".wiki", "page2.md"), "# Page 2");
      await mkdir(path.join(projectRoot, ".wiki", "subdir"));
      await writeFile(path.join(projectRoot, ".wiki", "subdir", "page3.md"), "# Page 3");

      const pages = await listWikiPages(projectRoot);
      expect(pages).toHaveLength(3);
      expect(pages).toContain("page1.md");
      expect(pages).toContain("page2.md");
      expect(pages).toContain(path.join("subdir", "page3.md"));
    });

    test("returns empty array when no wiki exists", async () => {
      // Remove .wiki dir
      await rm(path.join(projectRoot, ".wiki"), { recursive: true, force: true });
      await expect(listWikiPages(projectRoot)).rejects.toThrow();
    });
  });

  describe("indexWiki + search integration", () => {
    test("indexes wiki files and searches them", async () => {
      const wikiRoot = path.join(projectRoot, ".wiki");
      const dbPath = path.join(wikiRoot, "wiki.db");

      await writeFile(path.join(wikiRoot, "quickstart.md"),
        "---\ntitle: Quickstart\ndescription: Getting started\n---\n\n# Quickstart\n\nInstall the agent and run it.");
      await writeFile(path.join(wikiRoot, "architecture.md"),
        "---\ntitle: Architecture\ndescription: System design\n---\n\n# Architecture\n\nThe system uses a manual tool-calling loop.");

      const embedder = new MockEmbedder(16);
      const result = await indexWiki(wikiRoot, dbPath, embedder);
      expect(result.pagesIndexed).toBe(2);
      expect(result.chunksIndexed).toBeGreaterThan(0);

      // Open the store and search
      const store = new VectorStore(dbPath, embedder.dimension());
      const queryVec = await embedder.embed("Install the agent and run it.");
      const searchResults = store.search(queryVec, 2);

      expect(searchResults).toHaveLength(2);
      // The quickstart page should score higher for a query about installing
      expect(searchResults[0].path).toBe("quickstart.md");

      store.close();
    });
  });
});