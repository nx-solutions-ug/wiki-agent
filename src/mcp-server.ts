/**
 * MCP server module — exposes wiki-agent functionality as MCP tools over
 * stdio (or other transports).
 *
 * Tools exposed:
 *  1. read_wiki_page  — read a wiki page by relative path
 *  2. list_wiki_pages — list all wiki pages
 *  3. search_wiki     — semantic search over wiki content using embeddings (auto-syncs stale files)
 *  4. update_wiki     — trigger a wiki-agent update run (like `wiki --update`)
 *  5. rebuild_embeddings — full rebuild of the embeddings database from wiki content
 *  6. sync_embeddings    — incrementally sync embeddings (only re-embeds changed pages)
 *
 * The server is streamable: `wiki --mcp stdio` starts it on stdin/stdout.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runAgent } from "./agent.js";
import { createLLMClient, resolveConfig, createEmbeddingConfig } from "./config.js";
import {
  createEmbedder,
  indexWiki,
  openVectorStore,
  collectMarkdownFiles,
  syncEmbeddings,
  type Embedder,
  type SearchResult,
} from "./embeddings.js";
import { getGitSummary } from "./cli-helpers.js";

const DB_FILENAME = "wiki.db";

/**
 * Reads a wiki page by its relative path under .wiki/.
 * Returns the raw markdown content.
 */
async function readWikiPage(projectRoot: string, pagePath: string): Promise<string> {
  // Normalize and validate the path stays under .wiki/
  const wikiRoot = path.resolve(projectRoot, ".wiki");
  const resolved = path.resolve(wikiRoot, pagePath);

  if (!resolved.startsWith(wikiRoot + path.sep) && resolved !== wikiRoot) {
    throw new Error(`Path ${pagePath} resolves outside .wiki/.`);
  }

  // Add .md extension if not present
  const filePath = resolved.endsWith(".md") ? resolved : resolved + ".md";

  try {
    return await readFile(filePath, "utf8");
  } catch {
    throw new Error(`Wiki page not found: ${pagePath}`);
  }
}

/**
 * Lists all wiki markdown files as relative paths from .wiki/.
 */
async function listWikiPages(projectRoot: string): Promise<string[]> {
  const wikiRoot = path.resolve(projectRoot, ".wiki");
  const files = await collectMarkdownFiles(wikiRoot);
  return files
    .map(f => path.relative(wikiRoot, f))
    .filter(p => !p.startsWith(".."))
    .sort();
}

/**
 * Performs semantic search over the wiki using the embeddings database.
 * Automatically syncs stale files (added, modified, removed) before searching
 * so results always reflect the current state of the wiki on disk.
 */
async function searchWiki(
  projectRoot: string,
  query: string,
  k: number,
  embedder: Embedder,
): Promise<SearchResult[]> {
  const wikiRoot = path.join(projectRoot, ".wiki");
  const dbPath = path.join(wikiRoot, DB_FILENAME);

  // Auto-sync: detect and re-embed stale files before searching
  const syncResult = await syncEmbeddings(wikiRoot, dbPath, embedder);
  if (syncResult.synced && (syncResult.added.length > 0 || syncResult.updated.length > 0 || syncResult.removed.length > 0)) {
    const parts: string[] = [];
    if (syncResult.added.length > 0) parts.push(`${syncResult.added.length} added`);
    if (syncResult.updated.length > 0) parts.push(`${syncResult.updated.length} updated`);
    if (syncResult.removed.length > 0) parts.push(`${syncResult.removed.length} removed`);
    console.error(`[mcp] Embeddings auto-synced: ${parts.join(", ")}`);
  }

  const store = await openVectorStore(dbPath, embedder.dimension());
  if (!store) {
    throw new Error(
      "Embeddings database not found. Call the rebuild_embeddings tool first to build it.",
    );
  }

  try {
    const queryEmbedding = await embedder.embed(query);
    return store.search(queryEmbedding, k);
  } finally {
    store.close();
  }
}

/**
 * Runs a wiki-agent update, equivalent to `wiki --update --print`.
 * Returns a summary of what changed.
 */
async function updateWiki(projectRoot: string): Promise<string> {
  const config = await resolveConfig(projectRoot);
  const client = createLLMClient(config);

  const gitSummary = await getGitSummary(projectRoot);

  let summary = "";
  await runAgent(client, {
    command: "update",
    projectRoot,
    model: config.model,
    gitSummary,
    stream: false,
    onEvent: (event) => {
      if (event.type === "done") {
        summary = event.summary;
      }
    },
  });

  return summary || "Update complete.";
}

/**
 * Rebuilds the embeddings database from all wiki markdown files.
 */
async function rebuildEmbeddings(projectRoot: string): Promise<string> {
  const wikiRoot = path.join(projectRoot, ".wiki");
  const dbPath = path.join(wikiRoot, DB_FILENAME);
  const config = await resolveConfig(projectRoot);
  const embedder = await createEmbedder(createEmbeddingConfig(config));

  const result = await indexWiki(wikiRoot, dbPath, embedder);
  return `Indexed ${result.pagesIndexed} pages, ${result.chunksIndexed} chunks into ${DB_FILENAME}.`;
}

/**
 * Incrementally syncs the embeddings database — detects stale files
 * (added, modified, removed) and re-embeds only what changed.
 */
async function syncEmbeddingsTool(projectRoot: string): Promise<string> {
  const wikiRoot = path.join(projectRoot, ".wiki");
  const dbPath = path.join(wikiRoot, DB_FILENAME);
  const config = await resolveConfig(projectRoot);
  const embedder = await createEmbedder(createEmbeddingConfig(config));

  const result = await syncEmbeddings(wikiRoot, dbPath, embedder);

  if (!result.synced) {
    return `Embeddings are up to date. ${result.totalChunks} chunks in database.`;
  }

  const parts: string[] = [];
  if (result.added.length > 0) parts.push(`Added: ${result.added.length} (${result.added.join(", ")})`);
  if (result.updated.length > 0) parts.push(`Updated: ${result.updated.length} (${result.updated.join(", ")})`);
  if (result.removed.length > 0) parts.push(`Removed: ${result.removed.length} (${result.removed.join(", ")})`);

  return `Synced embeddings: ${parts.join("; ")}. ${result.totalChunks} chunks in database.`;
}

export interface McpServerOptions {
  projectRoot: string;
}

/**
 * Creates and configures an MCP server with all wiki-agent tools registered.
 * Returns the McpServer instance (not yet connected to a transport).
 */
export function createMcpServer(options: McpServerOptions): McpServer {
  const { projectRoot } = options;
  const server = new McpServer({
    name: "wiki-agent",
    version: "1.0.0",
  });

  // Tool: read_wiki_page
  server.registerTool(
    "read_wiki_page",
    {
      description:
        "Read a wiki page by its relative path under .wiki/. " +
        "The .md extension is added automatically if not provided. " +
        "Returns the raw markdown content.",
      inputSchema: {
        path: z.string().describe("Relative path to the wiki page (e.g. 'quickstart' or 'architecture/overview.md')"),
      },
    },
    async (args) => {
      try {
        const content = await readWikiPage(projectRoot, args.path);
        return {
          content: [{ type: "text" as const, text: content }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  // Tool: list_wiki_pages
  server.registerTool(
    "list_wiki_pages",
    {
      description:
        "List all wiki pages (markdown files) under .wiki/. " +
        "Returns relative paths sorted alphabetically.",
      inputSchema: {},
    },
    async () => {
      try {
        const pages = await listWikiPages(projectRoot);
        return {
          content: [{ type: "text" as const, text: pages.join("\n") }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  // Tool: search_wiki
  server.registerTool(
    "search_wiki",
    {
      description:
        "Semantic search over wiki content using the embeddings database. " +
        "Returns the most relevant chunks with their page paths, titles, and similarity scores. " +
        "The embeddings database must be built first using rebuild_embeddings.",
      inputSchema: {
        query: z.string().describe("The search query"),
        limit: z.number().optional().default(5).describe("Maximum number of results (default: 5)"),
      },
    },
    async (args) => {
      try {
        const config = await resolveConfig(projectRoot);
        const embedder = await createEmbedder(createEmbeddingConfig(config));
        const k = typeof args.limit === "number" ? args.limit : 5;
        const results = await searchWiki(projectRoot, args.query, k, embedder);

        if (results.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No results found." }],
          };
        }

        const text = results.map((r, i) =>
          `## Result ${i + 1} (score: ${r.score.toFixed(4)})\n` +
          `**Page:** ${r.path}\n` +
          `**Title:** ${r.title}\n` +
          `\n${r.chunk}\n`,
        ).join("\n---\n");

        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  // Tool: update_wiki
  server.registerTool(
    "update_wiki",
    {
      description:
        "Trigger a wiki-agent update run — inspects recent source changes and refreshes " +
        "wiki documentation pages. Equivalent to running 'wiki --update'. " +
        "Returns a summary of what changed. After the update, embeddings are " +
        "automatically synced to reflect the new wiki content.",
      inputSchema: {},
    },
    async () => {
      try {
        const summary = await updateWiki(projectRoot);
        // After the agent updates wiki pages, sync embeddings incrementally
        // so search results reflect the new content without a full rebuild.
        try {
          const syncSummary = await syncEmbeddingsTool(projectRoot);
          return {
            content: [{ type: "text" as const, text: `${summary}\n\n${syncSummary}` }],
          };
        } catch {
          // Sync is best-effort — the wiki update itself succeeded
          return {
            content: [{ type: "text" as const, text: summary }],
          };
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  // Tool: rebuild_embeddings
  server.registerTool(
    "rebuild_embeddings",
    {
      description:
        "Rebuild the embeddings database (.wiki/wiki.db) from all wiki markdown files. " +
        "This is a full rebuild — existing embeddings are replaced. " +
        "Use sync_embeddings instead for incremental updates (only re-embeds changed pages).",
      inputSchema: {},
    },
    async () => {
      try {
        const summary = await rebuildEmbeddings(projectRoot);
        return {
          content: [{ type: "text" as const, text: summary }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  // Tool: sync_embeddings
  server.registerTool(
    "sync_embeddings",
    {
      description:
        "Incrementally sync the embeddings database with on-disk wiki files. " +
        "Detects which pages were added, modified, or removed since the last index " +
        "and re-embeds only what changed. This is faster than rebuild_embeddings for " +
        "small updates. The search_wiki tool also calls this automatically before searching.",
      inputSchema: {},
    },
    async () => {
      try {
        const summary = await syncEmbeddingsTool(projectRoot);
        return {
          content: [{ type: "text" as const, text: summary }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  return server;
}

/**
 * Starts the MCP server on the stdio transport.
 * This is the main entry point for `wiki --mcp stdio`.
 */
export async function startMcpStdioServer(projectRoot: string): Promise<void> {
  const server = createMcpServer({ projectRoot });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Keep the process alive — the transport handles stdin/stdout
  // The server runs until the client disconnects or stdin closes
}

// Re-export for testing and external use
export { readWikiPage, listWikiPages, searchWiki };
