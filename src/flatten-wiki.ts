#!/usr/bin/env node
import { readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Characters forbidden in GitHub Wiki page filenames.
 * The wiki title is derived from the filename, so these must be stripped/replaced.
 */
const FORBIDDEN_CHARS = /[\\/:*?"<>|]/g;

/** Files excluded from the wiki publish (metadata, config, plan). */
const EXCLUDED = new Set([
  ".last-update-report.md",
  ".last-updated.json",
  "config.json",
  "_plan.md",
]);

/**
 * Converts a filename like "github-actions" or "overview" to a GitHub Wiki
 * page name. Dash/underscore-separated words become PascalCase:
 * "github-actions" → "GitHub-Actions", "overview" → "Overview",
 * "index" → "Home" (for the root index only).
 */
function toWikiPageName(filename: string): string {
  return filename
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("-");
}

/**
 * Cleans a filename for GitHub Wiki: replaces forbidden characters and
 * spaces with dashes, collapses repeated dashes.
 */
function cleanWikiFilename(name: string): string {
  return name
    .replace(FORBIDDEN_CHARS, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Computes the flat wiki filename for a source .wiki/ file given its
 * relative path. Examples:
 *   index.md                  → Home.md
 *   quickstart.md             → Quickstart.md
 *   architecture/index.md     → Architecture.md
 *   architecture/overview.md → Architecture-Overview.md
 *   cli/usage.md              → CLI-Usage.md
 */
function flatWikiFilename(relPath: string): string {
  const parts = relPath.split(path.sep);
  const basename = parts[parts.length - 1].replace(/\.md$/, "");

  if (basename === "index") {
    if (parts.length === 1) {
      return "Home.md";
    }
    return `${toWikiPageName(parts[parts.length - 2])}.md`;
  }

  const nameParts = parts.slice(0, -1).map((p) => toWikiPageName(p));
  nameParts.push(toWikiPageName(basename));
  return `${cleanWikiFilename(nameParts.join("-"))}.md`;
}

/**
 * Extracts the title from YAML frontmatter, falling back to the wiki name.
 */
function extractTitle(content: string, wikiName: string): string {
  const fmMatch = content.match(/^---\n[\s\S]*?title:\s*(.+?)\n[\s\S]*?---/);
  if (fmMatch) {
    return fmMatch[1].trim().replace(/['"]/g, "");
  }
  return wikiName.replace(/-/g, " ");
}

/**
 * Recursively walks the source .wiki/ directory and collects all .md files
 * with their relative paths, excluding metadata and config files.
 */
async function collectMarkdownFiles(
  srcDir: string,
  baseDir: string,
): Promise<{ relPath: string; absPath: string }[]> {
  const results: { relPath: string; absPath: string }[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = path.join(dir, entry.name);
      const relPath = path.relative(baseDir, absPath);

      if (entry.isDirectory()) {
        await walk(absPath);
      } else if (entry.name.endsWith(".md") && !EXCLUDED.has(entry.name)) {
        results.push({ relPath, absPath });
      }
    }
  }

  await walk(srcDir);
  return results;
}

/**
 * Rewrites internal markdown links from the nested .wiki/ structure to
 * flat wiki-page links. Uses a map of source-relative paths → flat wiki
 * names to correctly resolve links like `./cli/usage.md` → `CLI-Usage`
 * (not just `Usage`). Directory links like `./architecture/` resolve to
 * the section's index page (`Architecture`). Anchor fragments are preserved.
 *
 * @param content - the markdown file content
 * @param sourceRelDir - the directory of the source file, relative to .wiki/ (e.g. "cli", "")
 * @param pathMap - map of source-relative .md paths (without ./ prefix) → flat wiki names
 */
function rewriteLinks(
  content: string,
  sourceRelDir: string,
  pathMap: Map<string, string>,
): string {
  return content.replace(
    /\[([^\]]*)\]\(([^)]+)\)/g,
    (match, text: string, url: string) => {
      // Only rewrite internal .md links or directory links (not http URLs)
      if (url.startsWith("http://") || url.startsWith("https://")) {
        return match;
      }

      // Split off anchor fragment
      const hashIdx = url.indexOf("#");
      const anchor = hashIdx >= 0 ? url.slice(hashIdx) : "";
      const linkPath = hashIdx >= 0 ? url.slice(0, hashIdx) : url;

      // Resolve the link relative to the source file's directory
      const resolved = path
        .normalize(path.join(sourceRelDir, linkPath))
        .replace(/^\.\//, "");

      // Look up in the path map
      const wikiName = pathMap.get(resolved);
      if (wikiName) {
        return `[${text}](${wikiName}${anchor})`;
      }

      // Handle directory links (e.g. ./architecture/ → architecture/index.md)
      if (!linkPath.endsWith(".md")) {
        const dirIndex = pathMap.get(`${resolved}/index.md`);
        if (dirIndex) {
          return `[${text}](${dirIndex}${anchor})`;
        }
        const dirIndexNoSlash = pathMap.get(`${resolved.replace(/\/$/, "")}/index.md`);
        if (dirIndexNoSlash) {
          return `[${text}](${dirIndexNoSlash}${anchor})`;
        }
      }

      // Leave unresolvable links as-is
      return match;
    },
  );
}

/**
 * Generates the _Sidebar.md content from the collected pages, grouped by
 * their original top-level directory (or "Guides" for root-level pages).
 */
function generateSidebar(
  pages: { relPath: string; wikiName: string; title: string }[],
): string {
  const sections = new Map<string, { wikiName: string; title: string }[]>();

  for (const page of pages) {
    const parts = page.relPath.split(path.sep);
    const section = parts.length > 1 ? parts[0] : "Guides";
    const key = toWikiPageName(section);

    if (!sections.has(key)) {
      sections.set(key, []);
    }
    sections.get(key)!.push({ wikiName: page.wikiName, title: page.title });
  }

  const lines: string[] = ["# Navigation", "", "- [Home](Home)", ""];

  for (const [sectionName, sectionPages] of sections) {
    lines.push(`## ${sectionName}`, "");
    for (const page of sectionPages) {
      if (page.wikiName === "Home") continue;
      lines.push(`- [${page.title}](${page.wikiName})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Flattens the nested .wiki/ directory structure into a flat set of
 * GitHub Wiki-compatible files in the output directory.
 *
 * Conversion rules:
 * - .wiki/index.md                  → Home.md (the wiki landing page)
 * - .wiki/quickstart.md             → Quickstart.md
 * - .wiki/architecture/index.md     → Architecture.md
 * - .wiki/architecture/overview.md  → Architecture-Overview.md
 * - .wiki/cli/usage.md               → CLI-Usage.md
 * - Internal markdown links are rewritten from relative .md paths to flat
 *   wiki page names (e.g. [Text](./cli/usage.md) → [Text](CLI-Usage))
 * - _Sidebar.md is generated for navigation
 * - Metadata files (.last-update-report.md, .last-updated.json, config.json, _plan.md) are excluded
 *
 * @param wikiRoot - path to the .wiki/ directory (source)
 * @param outputDir - path to the output directory (will be created/cleaned)
 */
export async function flattenWiki(
  wikiRoot: string,
  outputDir: string,
): Promise<void> {
  // Clean and create output dir
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  // Collect all markdown files
  const files = await collectMarkdownFiles(wikiRoot, wikiRoot);

  // Build a path map: source-relative path → flat wiki name
  // e.g. "cli/usage.md" → "CLI-Usage", "index.md" → "Home"
  const pathMap = new Map<string, string>();
  for (const file of files) {
    const flatName = flatWikiFilename(file.relPath).replace(/\.md$/, "");
    pathMap.set(file.relPath, flatName);
  }

  const pageInfos: { relPath: string; wikiName: string; title: string }[] = [];

  for (const file of files) {
    const content = await readFile(file.absPath, "utf8");
    const flatFile = flatWikiFilename(file.relPath);
    const wikiName = flatFile.replace(/\.md$/, "");

    // Determine the source file's directory relative to .wiki/
    const sourceRelDir = path.dirname(file.relPath) === "." ? "" : path.dirname(file.relPath);

    // Rewrite links
    const rewritten = rewriteLinks(content, sourceRelDir, pathMap);

    // Extract title for sidebar
    const title = extractTitle(content, wikiName);
    pageInfos.push({ relPath: file.relPath, wikiName, title });

    // Write the file
    await writeFile(path.join(outputDir, flatFile), rewritten, "utf8");
  }

  // Generate _Sidebar.md
  const sidebar = generateSidebar(pageInfos);
  await writeFile(path.join(outputDir, "_Sidebar.md"), sidebar, "utf8");
}

// CLI entrypoint: node dist/flatten-wiki.js <wiki-root> <output-dir>
if (process.argv[1] && process.argv[1].endsWith("flatten-wiki.js")) {
  const [wikiRoot, outputDir] = process.argv.slice(2);
  if (!wikiRoot || !outputDir) {
    console.error("Usage: node flatten-wiki.js <wiki-root> <output-dir>");
    process.exit(1);
  }
  flattenWiki(wikiRoot, outputDir)
    .then(() => console.log(`Flattened ${wikiRoot} to ${outputDir}/`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}