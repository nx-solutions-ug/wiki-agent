import { readFile, writeFile, readdir, stat, open } from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { parse } from "yaml";

const INDEX_FILE = "index.md";
const EXCLUDED_FILES = new Set([INDEX_FILE, "_plan.md"]);

interface Link {
  href: string;
  label: string;
  description?: string;
}

interface DirectoryEntry {
  name: string;
  isDir: boolean;
}

/**
 * Synchronizes index.md files for every directory under the wiki root.
 * Call this after the agent run completes.
 */
export async function synchronizeWikiIndexes(
  wikiRoot: string,
): Promise<void> {
  try {
    await stat(wikiRoot);
  } catch {
    return;
  }

  await synchronizeDirectory(wikiRoot, wikiRoot);
}

async function synchronizeDirectory(
  dirPath: string,
  root: string,
): Promise<void> {
  const entries = await collectEntries(dirPath);

  const files: Link[] = [];
  const directories: Link[] = [];

  // Process entries concurrently in bounded chunks. The cap is per-level:
  // each recursive synchronizeDirectory call manages its own chunk, so live
  // concurrency scales with directory depth (16 × max_depth at most). Errors
  // propagate — a failing entry rejects its chunk and aborts the sync, mirroring
  // the original sequential behavior where the first parseFrontmatter error
  // surfaced up to synchronizeWikiIndexes' caller. The shared `files`/
  // `directories` arrays are safe to mutate across concurrent callbacks: JS is
  // single-threaded, so each push runs in its own synchronous segment, and
  // renderLinks sorts by href before emitting, making the output
  // order-independent.
  const CHUNK_SIZE = 16;
  for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
    await Promise.all(
      entries.slice(i, i + CHUNK_SIZE).map(async (entry) => {
        if (!entry.name || entry.name.startsWith(".")) return;

        if (entry.isDir) {
          directories.push({ href: `${encodeURIComponent(entry.name)}/`, label: entry.name });
          await synchronizeDirectory(path.join(dirPath, entry.name), root);
          return;
        }

        if (path.extname(entry.name).toLowerCase() !== ".md") return;
        if (EXCLUDED_FILES.has(entry.name)) return;

        const filePath = path.join(dirPath, entry.name);
        const metadata = await parseFrontmatter(filePath);
        files.push({
          description: metadata.description,
          href: encodeURIComponent(entry.name),
          label: metadata.title ?? path.basename(entry.name, ".md"),
        });
      }),
    );
  }

  const indexPath = path.join(dirPath, INDEX_FILE);
  const title =
    dirPath === root ? "Wiki" : titleFromSlug(path.basename(dirPath));
  const content = renderIndex(title, files, directories);

  let existing: string | null = null;
  try {
    existing = await readFile(indexPath, "utf8");
  } catch {
    // index.md doesn't exist yet
  }

  if (existing === content) return;

  await writeFile(indexPath, content, "utf8");
}

async function collectEntries(dirPath: string): Promise<DirectoryEntry[]> {
  const names = await readdir(dirPath, { withFileTypes: true });
  return names.map((entry) => ({
    name: entry.name,
    isDir: entry.isDirectory(),
  }));
}

function renderIndex(
  title: string,
  files: Link[],
  directories: Link[],
): string {
  const sections = [
    renderLinks("Files", files, true),
    renderLinks("Directories", directories, false),
  ]
    .filter(Boolean)
    .join("\n\n");

  return `---\ntype: Documentation Index\ntitle: ${JSON.stringify(title)}\ndescription: ${JSON.stringify(`Files and subdirectories in ${title}.`)}\n---\n\n${sections}\n`;
}

function renderLinks(
  heading: string,
  links: Link[],
  includeDescription: boolean,
): string {
  if (links.length === 0) return "";

  links.sort((left, right) => left.href.localeCompare(right.href));

  const items = links.map(({ description, href, label }) => {
    const link = `- [${escapeLabel(label)}](${href})`;
    return includeDescription && description
      ? `${link} - ${description}`
      : link;
  });

  return `# ${heading}\n\n${items.join("\n")}`;
}

interface FrontmatterMetadata {
  description?: string;
  title?: string;
}

async function parseFrontmatter(
  filePath: string,
): Promise<FrontmatterMetadata> {
  let content = "";
  let fileHandle;

  try {
    fileHandle = await open(filePath, "r");
    const decoder = new StringDecoder("utf8");
    const buffer = Buffer.alloc(4096);

    while (true) {
      const result = await fileHandle.read(buffer, 0, buffer.length, null);
      if (result.bytesRead === 0) {
        content += decoder.end();
        break;
      }
      content += decoder.write(buffer.subarray(0, result.bytesRead));

      // Stop early if the file definitely does not start with frontmatter
      if (content.length >= 4 && !content.startsWith("---\n") && !content.startsWith("---\r\n")) {
        break;
      }

      // Stop reading as soon as we have the full frontmatter block
      if (/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u.test(content)) {
        break;
      }

      // Safety bound: don't read huge files looking for missing end marker
      if (content.length > 16384) {
        break;
      }
    }
  } catch {
    return {};
  } finally {
    if (fileHandle) {
      try {
        await fileHandle.close();
      } catch {
        // Ignore close errors
      }
    }
  }

  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content)?.[1];

  if (!block) return {};

  let fields: unknown;

  try {
    fields = parse(`\n${block}`, {
      maxAliasCount: 100,
      schema: "core",
      uniqueKeys: true,
    }) as unknown;
  } catch (error) {
    throw new Error(
      `${filePath} contains invalid YAML front matter: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (fields === null || typeof fields !== "object" || Array.isArray(fields)) {
    throw new Error(`${filePath} YAML front matter must be a mapping.`);
  }

  const { description, title } = fields as Record<string, unknown>;

  if (
    description !== undefined &&
    (typeof description !== "string" || !description.trim())
  ) {
    throw new Error(`${filePath} YAML description must be a non-empty string.`);
  }

  if (title !== undefined && typeof title !== "string") {
    throw new Error(`${filePath} YAML title must be a string.`);
  }

  return {
    ...(description ? { description } : {}),
    ...(title ? { title } : {}),
  };
}

function titleFromSlug(slug: string): string {
  return slug
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function escapeLabel(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}
