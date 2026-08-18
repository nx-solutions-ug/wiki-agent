/**
 * Embeddings module — provides pluggable text embeddings for wiki pages.
 *
 * Two embedding backends are supported:
 *  - "local":  Hugging Face Transformers.js (Xenova/all-MiniLM-L6-v2, 384-dim).
 *             Runs entirely on-device; model weights are cached after first
 *             download.
 *  - "ollama": Ollama embeddings API (configurable model, e.g.
 *             nomic-embed-text).  Requires a running Ollama server.
 *
 * The vector store uses better-sqlite3 + sqlite-vec for on-disk persistence
 * in `.wiki/wiki.db`.
 */

import { readFile, readdir, stat, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { Ollama } from "ollama";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EmbeddingProvider = "local" | "ollama";

export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  /** Ollama embedding model (only used when provider === "ollama"). */
  ollamaModel: string;
  /** Base URL for the Ollama server (only used when provider === "ollama"). */
  ollamaHost: string;
}

/** A search result row. */
export interface SearchResult {
  path: string;
  title: string;
  chunk: string;
  score: number;
}

// ---------------------------------------------------------------------------
// Embedder interface & implementations
// ---------------------------------------------------------------------------

export interface Embedder {
  /** Returns the dimensionality of the vectors produced. */
  dimension(): number;
  /** Embeds a single text string into a Float32Array. */
  embed(text: string): Promise<Float32Array>;
}

// ---- Local (Transformers.js) -----------------------------------------------

const LOCAL_MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const LOCAL_DIMENSION = 384;

type FeatureExtractionPipeline = (
  text: string | string[],
  options?: Record<string, unknown>,
) => Promise<{ data: Float32Array | number[] }>;

export class LocalEmbedder implements Embedder {
  private pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

  constructor() {
    // Set cache dir to a user-level location so models persist across projects
    if (!process.env.TRANSFORMERS_CACHE) {
      process.env.TRANSFORMERS_CACHE = path.join(
        process.env.HOME || process.env.USERPROFILE || ".",
        ".wiki",
        "model-cache",
      );
    }
  }

  private getPipeline(): Promise<FeatureExtractionPipeline> {
    if (!this.pipelinePromise) {
      this.pipelinePromise = (async () => {
        // Dynamic import required: @huggingface/transformers is ESM-only and
        // loading it eagerly would break CommonJS consumers. The specifier is
        // a literal but the package exports map only resolves under ESM.
        const mod = await import("@huggingface/transformers");
        const extractor = await mod.pipeline("feature-extraction", LOCAL_MODEL_ID);
        return extractor as FeatureExtractionPipeline;
      })();
    }
    return this.pipelinePromise;
  }

  dimension(): number {
    return LOCAL_DIMENSION;
  }

  async embed(text: string): Promise<Float32Array> {
    const extractor = await this.getPipeline();
    const result = await extractor(text, { pooling: "mean", normalize: true });
    const data = result.data;
    if (data instanceof Float32Array) {
      return data;
    }
    return new Float32Array(data);
  }
}

// ---- Ollama ----------------------------------------------------------------

export class OllamaEmbedder implements Embedder {
  private ollama: Ollama;
  private model: string;
  private _dimension: number | null = null;

  constructor(model: string, host: string) {
    this.ollama = new Ollama({ host });
    this.model = model;
  }

  dimension(): number {
    if (this._dimension === null) {
      throw new Error(
        "OllamaEmbedder.dimension() called before embed(); call detectDimension() first.",
      );
    }
    return this._dimension;
  }

  async detectDimension(): Promise<number> {
    const vec = await this.embed("dimension probe");
    this._dimension = vec.length;
    return vec.length;
  }

  async embed(text: string): Promise<Float32Array> {
    const response = await this.ollama.embed({
      model: this.model,
      input: text,
    });
    const embedding = response.embeddings?.[0];
    if (!embedding) {
      throw new Error(`Ollama returned no embedding for model ${this.model}`);
    }
    this._dimension = embedding.length;
    return new Float32Array(embedding);
  }
}

// ---- Factory ---------------------------------------------------------------

export async function createEmbedder(config: EmbeddingConfig): Promise<Embedder> {
  if (config.provider === "local") {
    return new LocalEmbedder();
  }
  const embedder = new OllamaEmbedder(config.ollamaModel, config.ollamaHost);
  // Eagerly detect dimension so dimension() is available synchronously
  await embedder.detectDimension();
  return embedder;
}

// ---------------------------------------------------------------------------
// Vector store (better-sqlite3 + sqlite-vec)
// ---------------------------------------------------------------------------

/**
 * On-disk vector store for wiki page embeddings.
 *
 * Each row is a chunk of text from a wiki page, stored with its path, title,
 * and a Float32 embedding blob.  Semantic search uses cosine distance.
 */
export class VectorStore {
  private db: Database.Database;
  private dim: number;
  private dbPath: string;

  constructor(dbPath: string, dimension: number) {
    this.dbPath = dbPath;
    this.dim = dimension;
    this.db = new Database(dbPath);
    // @ts-expect-error — enableLoadExtension is a runtime property not in the type declarations
    this.db.enableLoadExtension = true;
    sqliteVec.load(this.db);
    // @ts-expect-error — enableLoadExtension is a runtime property not in the type declarations
    this.db.enableLoadExtension = false;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wiki_pages (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        path      TEXT NOT NULL,
        title     TEXT NOT NULL DEFAULT '',
        chunk     TEXT NOT NULL,
        embedding BLOB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_wiki_pages_path ON wiki_pages(path);

      -- Tracks the file mtime and chunk count per indexed page so we can
      -- detect stale entries and incrementally sync without a full rebuild.
      CREATE TABLE IF NOT EXISTS page_meta (
        path        TEXT PRIMARY KEY,
        mtime       INTEGER NOT NULL,
        chunk_count INTEGER NOT NULL,
        title       TEXT NOT NULL DEFAULT ''
      );
    `);
  }

  /**
   * Removes all chunks for a given page path.
   */
  clearPage(pagePath: string): void {
    this.db.prepare("DELETE FROM wiki_pages WHERE path = ?").run(pagePath);
    this.db.prepare("DELETE FROM page_meta WHERE path = ?").run(pagePath);
  }


  /**
   * Stores or updates metadata for a page (mtime, chunk count, title).
   * Called after inserting all chunks for a page.
   */
  upsertPageMeta(pagePath: string, mtime: number, chunkCount: number, title: string): void {
    this.db.prepare(`
      INSERT INTO page_meta (path, mtime, chunk_count, title)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET mtime = excluded.mtime, chunk_count = excluded.chunk_count, title = excluded.title
    `).run(pagePath, mtime, chunkCount, title);
  }

  /**
   * Removes metadata for a page. Called when a page is deleted or cleared.
   */
  deletePageMeta(pagePath: string): void {
    this.db.prepare("DELETE FROM page_meta WHERE path = ?").run(pagePath);
  }

  /**
   * Returns metadata for all indexed pages, keyed by path.
   */
  allPageMeta(): Map<string, { mtime: number; chunkCount: number; title: string }> {
    const rows = this.db.prepare("SELECT path, mtime, chunk_count, title FROM page_meta").all() as {
      path: string; mtime: number; chunk_count: number; title: string;
    }[];
    return new Map(rows.map(r => [r.path, { mtime: r.mtime, chunkCount: r.chunk_count, title: r.title }]));
  }
  /**
   * Inserts a chunk with its embedding.
   */
  insertChunk(pagePath: string, title: string, chunk: string, embedding: Float32Array): void {
    const buf = Buffer.from(embedding.buffer);
    this.db.prepare(
      "INSERT INTO wiki_pages (path, title, chunk, embedding) VALUES (?, ?, ?, ?)",
    ).run(pagePath, title, chunk, buf);
  }

  /**
   * Semantic search: returns the top-k closest chunks by cosine distance.
   */
  search(queryEmbedding: Float32Array, k: number = 5): SearchResult[] {
    const buf = Buffer.from(queryEmbedding.buffer);
    const rows = this.db.prepare(`
      SELECT
        path,
        title,
        chunk,
        vec_distance_cosine(?, embedding) AS distance
      FROM wiki_pages
      ORDER BY distance ASC
      LIMIT ?
    `).all(buf, k) as { path: string; title: string; chunk: string; distance: number }[];

    return rows.map(r => ({
      path: r.path,
      title: r.title,
      chunk: r.chunk,
      score: 1 - r.distance,
    }));
  }

  /**
   * Returns the total number of embedded chunks.
   */
  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS cnt FROM wiki_pages").get() as { cnt: number };
    return row.cnt;
  }

  /**
   * Returns all distinct page paths in the store.
   */
  pagePaths(): string[] {
    const rows = this.db.prepare("SELECT DISTINCT path FROM wiki_pages ORDER BY path").all() as { path: string }[];
    return rows.map(r => r.path);
  }

  close(): void {
    this.db.close();
  }

  /** Returns the path of the database file. */
  get filePath(): string {
    return this.dbPath;
  }
}

// ---------------------------------------------------------------------------
// Indexing: build / rebuild the embeddings database from .wiki/ markdown files
// ---------------------------------------------------------------------------

const MAX_CHUNK_LENGTH = 1200;
const CHUNK_OVERLAP = 150;

/**
 * Splits a markdown document into overlapping chunks of roughly MAX_CHUNK_LENGTH
 * characters, breaking on paragraph boundaries where possible.
 */
export function chunkMarkdown(content: string): string[] {
  // Strip frontmatter
  const withoutFrontmatter = content.replace(/^---[\s\S]*?---\s*/, "");
  const paragraphs = withoutFrontmatter.split(/\n\s*\n/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > MAX_CHUNK_LENGTH && current.length > 0) {
      chunks.push(current.trim());
      const overlap = current.slice(-CHUNK_OVERLAP);
      current = overlap + "\n\n" + para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }

  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }

  // Handle very long paragraphs by splitting on sentences
  const result: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= MAX_CHUNK_LENGTH) {
      result.push(chunk);
    } else {
      const sentences = chunk.split(/(?<=[.!?])\s+/);
      let buf = "";
      for (const sentence of sentences) {
        if (buf.length + sentence.length + 1 > MAX_CHUNK_LENGTH && buf.length > 0) {
          result.push(buf.trim());
          buf = sentence;
        } else {
          buf = buf ? buf + " " + sentence : sentence;
        }
      }
      if (buf.trim().length > 0) {
        result.push(buf.trim());
      }
    }
  }

  return result.length > 0 ? result : [withoutFrontmatter.trim()].filter(s => s.length > 0);
}

/**
 * Extracts a title from markdown frontmatter or the first heading.
 */
export function extractTitle(content: string): string {
  // Try YAML frontmatter title field
  const fmMatch = content.match(/^---[\s\S]*?^title:\s*(.+)$/m);
  if (fmMatch) {
    return fmMatch[1].trim().replace(/^["']|["']$/g, "");
  }
  // Try first markdown heading
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) {
    return headingMatch[1].trim();
  }
  return "";
}

/**
 * Recursively collects all .md file paths under a directory.
 */
export async function collectMarkdownFiles(dirPath: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      const subResults = await collectMarkdownFiles(fullPath);
      results.push(...subResults);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Indexes all wiki markdown files into the vector store.
 * Clears existing data first (full rebuild).
 *
 * @param wikiRoot  Absolute path to the .wiki/ directory
 * @param dbPath    Absolute path to the wiki.db file
 * @param embedder  The embedder to use
 * @param onProgress Optional callback called with (currentPage, totalPages)
 * @returns Object with stats about the index operation
 */
export async function indexWiki(
  wikiRoot: string,
  dbPath: string,
  embedder: Embedder,
  onProgress?: (current: number, total: number, currentPage: string) => void,
): Promise<{ pagesIndexed: number; chunksIndexed: number; dbPath: string }> {
  await mkdir(path.dirname(dbPath), { recursive: true });

  // Remove existing db to start fresh (full rebuild)
  try {
    await unlink(dbPath);
  } catch {
    // File may not exist — fine
  }

  const store = new VectorStore(dbPath, embedder.dimension());

  // Collect all markdown files, excluding index.md and _plan.md
  const allFiles = await collectMarkdownFiles(wikiRoot);
  const mdFiles = allFiles.filter(f => {
    const base = path.basename(f);
    return base !== "index.md" && base !== "_plan.md";
  });

  let chunksIndexed = 0;

  for (let i = 0; i < mdFiles.length; i++) {
    const filePath = mdFiles[i];
    const relativePath = path.relative(wikiRoot, filePath);

    try {
      const content = await readFile(filePath, "utf8");
      const title = extractTitle(content);
      const chunks = chunkMarkdown(content);
      const fileStat = await stat(filePath);

      store.clearPage(relativePath);

      for (const chunk of chunks) {
        const embedding = await embedder.embed(chunk);
        store.insertChunk(relativePath, title, chunk, embedding);
        chunksIndexed++;
      }

      store.upsertPageMeta(relativePath, Math.floor(fileStat.mtimeMs), chunks.length, title);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[embeddings] Skipping ${relativePath}: ${msg}`);
    }

    if (onProgress) {
      onProgress(i + 1, mdFiles.length, relativePath);
    }
  }

  store.close();
  return { pagesIndexed: mdFiles.length, chunksIndexed, dbPath };
}

/**
 * Opens an existing vector store for querying, or returns null if the
 * database doesn't exist yet.
 */
export async function openVectorStore(dbPath: string, dimension: number): Promise<VectorStore | null> {
  try {
    const s = await stat(dbPath);
    if (!s.isFile()) {
      return null;
    }
    return new VectorStore(dbPath, dimension);
  } catch {
    return null;
  }
}

/**
 * Result of a sync operation.
 */
export interface SyncResult {
  added: string[];
  updated: string[];
  removed: string[];
  pagesSynced: number;
  totalChunks: number;
  synced: boolean;
}

/**
 * Compares the on-disk wiki files against the page_meta table in the vector
 * store to determine which pages are stale (added, modified, or removed).
 *
 * Returns null if the database doesn't exist (caller should do a full rebuild).
 */
export async function detectStaleFiles(
  wikiRoot: string,
  dbPath: string,
  dimension: number,
): Promise<{ added: string[]; updated: string[]; removed: string[] } | null> {
  const store = await openVectorStore(dbPath, dimension);
  if (!store) {
    return null;
  }

  try {
    const metaMap = store.allPageMeta();

    const allFiles = await collectMarkdownFiles(wikiRoot);
    const mdFiles = allFiles.filter(f => {
      const base = path.basename(f);
      return base !== "index.md" && base !== "_plan.md";
    });

    const currentPaths = new Set<string>();
    const added: string[] = [];
    const updated: string[] = [];

    for (const filePath of mdFiles) {
      const relativePath = path.relative(wikiRoot, filePath);
      currentPaths.add(relativePath);

      const fileStat = await stat(filePath);
      const mtime = Math.floor(fileStat.mtimeMs);
      const existing = metaMap.get(relativePath);

      if (!existing) {
        added.push(relativePath);
      } else if (mtime > existing.mtime) {
        updated.push(relativePath);
      }
    }

    const removed: string[] = [];
    for (const dbPagePath of metaMap.keys()) {
      if (!currentPaths.has(dbPagePath)) {
        removed.push(dbPagePath);
      }
    }

    return { added, updated, removed };
  } finally {
    store.close();
  }
}

/**
 * Incrementally syncs the embeddings database with on-disk wiki files.
 *
 * - Re-embeds added and modified pages
 * - Removes deleted pages from the DB
 * - Leaves unchanged pages alone
 *
 * If the database doesn't exist yet, falls back to a full indexWiki.
 */
export async function syncEmbeddings(
  wikiRoot: string,
  dbPath: string,
  embedder: Embedder,
): Promise<SyncResult> {
  // If no DB exists, do a full rebuild
  const existing = await openVectorStore(dbPath, embedder.dimension());
  if (!existing) {
    const result = await indexWiki(wikiRoot, dbPath, embedder);
    return {
      added: [],
      updated: [],
      removed: [],
      pagesSynced: result.pagesIndexed,
      totalChunks: result.chunksIndexed,
      synced: true,
    };
  }
  existing.close();

  const stale = await detectStaleFiles(wikiRoot, dbPath, embedder.dimension());
  if (!stale) {
    const result = await indexWiki(wikiRoot, dbPath, embedder);
    return {
      added: [],
      updated: [],
      removed: [],
      pagesSynced: result.pagesIndexed,
      totalChunks: result.chunksIndexed,
      synced: true,
    };
  }

  const { added, updated, removed } = stale;

  if (added.length === 0 && updated.length === 0 && removed.length === 0) {
    const store = await openVectorStore(dbPath, embedder.dimension());
    const totalChunks = store ? store.count() : 0;
    if (store) store.close();
    return { added, updated, removed, pagesSynced: 0, totalChunks, synced: false };
  }

  const store = await openVectorStore(dbPath, embedder.dimension());
  if (!store) {
    const result = await indexWiki(wikiRoot, dbPath, embedder);
    return {
      added: [],
      updated: [],
      removed: [],
      pagesSynced: result.pagesIndexed,
      totalChunks: result.chunksIndexed,
      synced: true,
    };
  }

  try {
    for (const pagePath of removed) {
      store.clearPage(pagePath);
    }

    const changedPaths = [...added, ...updated];
    for (const relativePath of changedPaths) {
      const filePath = path.join(wikiRoot, relativePath);
      try {
        const content = await readFile(filePath, "utf8");
        const title = extractTitle(content);
        const chunks = chunkMarkdown(content);
        const fileStat = await stat(filePath);

        store.clearPage(relativePath);

        for (const chunk of chunks) {
          const embedding = await embedder.embed(chunk);
          store.insertChunk(relativePath, title, chunk, embedding);
        }

        store.upsertPageMeta(relativePath, Math.floor(fileStat.mtimeMs), chunks.length, title);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[embeddings] Skipping ${relativePath}: ${msg}`);
      }
    }

    return {
      added,
      updated,
      removed,
      pagesSynced: changedPaths.length,
      totalChunks: store.count(),
      synced: true,
    };
  } finally {
    store.close();
  }
}