import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  chunkMarkdown,
  extractTitle,
  collectMarkdownFiles,
  VectorStore,
  type Embedder,
} from "../src/embeddings.js";

function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "wiki-embed-test-"));
}

// A deterministic mock embedder for testing — maps characters to a fixed-dim vector
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

describe("chunkMarkdown", () => {
  test("returns content without frontmatter", () => {
    const content = "---\ntitle: Test\n---\n\nThis is a test paragraph.";
    const chunks = chunkMarkdown(content);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain("This is a test paragraph");
  });

  test("splits long content into multiple chunks", () => {
    const para = "This is a paragraph. ".repeat(100);
    const content = para + "\n\n" + para;
    const chunks = chunkMarkdown(content);
    expect(chunks.length).toBeGreaterThan(1);
  });

  test("handles empty content", () => {
    const chunks = chunkMarkdown("");
    expect(chunks).toEqual([]);
  });

  test("handles single short paragraph", () => {
    const chunks = chunkMarkdown("Hello world.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe("Hello world.");
  });
});

describe("extractTitle", () => {
  test("extracts title from YAML frontmatter", () => {
    const content = "---\ntitle: My Wiki Page\ndescription: A test\n---\n\n# Heading";
    expect(extractTitle(content)).toBe("My Wiki Page");
  });

  test("extracts title from quoted frontmatter", () => {
    const content = '---\ntitle: "Quoted Title"\n---\n\n# Heading';
    expect(extractTitle(content)).toBe("Quoted Title");
  });

  test("falls back to first heading", () => {
    const content = "# My Heading\n\nSome content.";
    expect(extractTitle(content)).toBe("My Heading");
  });

  test("returns empty string when no title found", () => {
    const content = "Just some content without frontmatter or heading.";
    expect(extractTitle(content)).toBe("");
  });
});

describe("collectMarkdownFiles", () => {
  let tempBase: string;

  beforeEach(async () => {
    tempBase = await tempDir();
  });

  afterEach(async () => {
    await rm(tempBase, { recursive: true, force: true });
  });

  test("collects all .md files recursively", async () => {
    await writeFile(path.join(tempBase, "page1.md"), "# Page 1");
    await mkdir(path.join(tempBase, "subdir"));
    await writeFile(path.join(tempBase, "subdir", "page2.md"), "# Page 2");
    await writeFile(path.join(tempBase, "notmd.txt"), "not markdown");

    const files = await collectMarkdownFiles(tempBase);
    expect(files).toHaveLength(2);
    expect(files.some(f => f.endsWith("page1.md"))).toBe(true);
    expect(files.some(f => f.endsWith("page2.md"))).toBe(true);
  });

  test("returns empty array for empty directory", async () => {
    const files = await collectMarkdownFiles(tempBase);
    expect(files).toEqual([]);
  });
});

describe("VectorStore", () => {
  let tempBase: string;
  let dbPath: string;

  beforeEach(async () => {
    tempBase = await tempDir();
    dbPath = path.join(tempBase, "test.db");
  });

  afterEach(async () => {
    await rm(tempBase, { recursive: true, force: true });
  });

  test("inserts and searches chunks", async () => {
    const embedder = new MockEmbedder(16);
    const store = new VectorStore(dbPath, embedder.dimension());

    store.insertChunk("page1.md", "Page 1", "Hello world content", await embedder.embed("Hello world content"));
    store.insertChunk("page2.md", "Page 2", "Different text here", await embedder.embed("Different text here"));

    expect(store.count()).toBe(2);

    const queryVec = await embedder.embed("Hello world content");
    const results = store.search(queryVec, 2);

    expect(results).toHaveLength(2);
    expect(results[0].path).toBe("page1.md");
    expect(results[0].title).toBe("Page 1");
    expect(results[0].chunk).toContain("Hello world");
    expect(results[0].score).toBeGreaterThan(0);

    store.close();
  });

  test("clearPage removes chunks for a path", async () => {
    const embedder = new MockEmbedder(16);
    const store = new VectorStore(dbPath, embedder.dimension());

    store.insertChunk("page1.md", "Page 1", "content1", await embedder.embed("content1"));
    store.insertChunk("page2.md", "Page 2", "content2", await embedder.embed("content2"));

    expect(store.count()).toBe(2);

    store.clearPage("page1.md");
    expect(store.count()).toBe(1);
    expect(store.pagePaths()).toEqual(["page2.md"]);

    store.close();
  });

  test("pagePaths returns distinct paths", async () => {
    const embedder = new MockEmbedder(16);
    const store = new VectorStore(dbPath, embedder.dimension());

    store.insertChunk("page1.md", "Page 1", "chunk1", await embedder.embed("chunk1"));
    store.insertChunk("page1.md", "Page 1", "chunk2", await embedder.embed("chunk2"));
    store.insertChunk("page2.md", "Page 2", "chunk3", await embedder.embed("chunk3"));

    const paths = store.pagePaths();
    expect(paths).toEqual(["page1.md", "page2.md"]);

    store.close();
  });
});