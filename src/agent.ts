import { mkdir, writeFile, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { createSystemPrompt, createUserMessage, type WikiCommand } from "./prompt.js";
import { createTools, executeTool, stripThinkingTags } from "./tools.js";
import { synchronizeWikiIndexes } from "./index-middleware.js";
import { VERSION } from "./version.js";
import { type LLMClient, type LLMMessage, type LLMToolCall } from "./llm.js";
import { createWorkflowFile } from "./workflow.js";

const execFileAsync = promisify(execFile);

export type AgentEvent =
  | { type: "assistant"; content: string }
  | { type: "tool"; name: string; result: string }
  | { type: "error"; message: string }
  | { type: "done"; summary: string };

const DEFAULT_MAX_ITERATIONS = 200;
/**
 * Run-metadata files written under .wiki/ after each run. These are
 * regenerated on every run, excluded from wiki publishing and from the
 * staging-PR has_changes gate, and gitignored so they never enter git
 * history. They exist on disk for human/CI inspection only.
 */
const RUN_METADATA_FILES = [
  ".last-updated.json",
  ".last-update-report.md",
  ".last-update-title.txt",
] as const;

// SQLite database and its sidecar files (journal, WAL, shared-memory).
// The embeddings database is binary and should be rebuilt locally, not
// committed or published.
const SQLITE_DB_FILES = [
  "wiki.db",
  "wiki.db-journal",
  "wiki.db-wal",
  "wiki.db-shm",
] as const;

// Files excluded from git tracking under .wiki/.  Run-metadata files are
// transient; wiki.db (+ sidecars) is a binary embeddings database that
// should be rebuilt locally, not committed or published.
export const WIKI_GITIGNORE =
  RUN_METADATA_FILES.map((f) => `/${f}`).join("\n") + "\n" +
  SQLITE_DB_FILES.map((f) => `/${f}`).join("\n") + "\n";

/**
 * Filters a changed-files list for report generation: drops run-metadata
 * file paths and dedupes by path so the report reflects only real wiki
 * content changes (one entry per file). Exported for testing.
 */
export function filterReportFiles(
  files: { action: string; path: string; description?: string }[],
): { action: string; path: string; description?: string }[] {
  const metadataSet = new Set<string>(RUN_METADATA_FILES);
  const seenPaths = new Set<string>();
  const result: { action: string; path: string; description?: string }[] = [];
  for (const f of files) {
    const base = path.basename(f.path);
    if (metadataSet.has(base)) continue;
    if (seenPaths.has(f.path)) continue;
    seenPaths.add(f.path);
    result.push(f);
  }
  return result;
}
/**
 * Checks whether any run-metadata files under .wiki/ are currently tracked by
 * Git. If any are tracked (e.g. in legacy repositories that committed them
 * before they were gitignored), untracks them via `git rm --cached` so they
 * no longer pollute future commits or staging PRs. Exported for testing.
 */
export async function untrackRunMetadataFiles(
  projectRoot: string,
): Promise<string[]> {
  const metadataPaths = [
    ...RUN_METADATA_FILES.map((f) => path.join(".wiki", f)),
    ...SQLITE_DB_FILES.map((f) => path.join(".wiki", f)),
  ];
  try {
    const { stdout } = await execFileAsync("git", ["ls-files", ...metadataPaths], {
      cwd: projectRoot,
    });
    const tracked = stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    if (tracked.length > 0) {
      // -f overrides the modification guard since these files are regenerated
      // every run and will have unstaged modifications; --cached keeps them
      // on disk while removing them from the git index.
      await execFileAsync("git", ["rm", "--cached", "-f", ...tracked], {
        cwd: projectRoot,
      });
      return tracked;
    }
  } catch {
    // Ignore git execution errors (e.g. not a git repo or git not available)
  }
  return [];
}
/**
 * Marker string used to detect an existing wiki-agent section in
 * AGENTS.md / CLAUDE.md so the appender is idempotent.
 */
const WIKI_AGENT_MARKER = "<!-- wiki-agent -->";

/**
 * Builds the wiki-agent markdown section appended to AGENTS.md / CLAUDE.md
 * on `--init` runs. Declares that the project is managed by wiki-agent and
 * records the version and timestamp for traceability.
 */
function buildWikiAgentSection(): string {
  const timestamp = new Date().toISOString();
  return [
    "",
    WIKI_AGENT_MARKER,
    "## Wiki Agent",
    "",
    "This repository is managed by [wiki-agent](https://github.com/nx-solutions-ug/wiki-agent).",
    "Documentation is generated under `.wiki/` and kept in sync via `wiki --update`.",
    "Do not hand-edit files under `.wiki/` — regenerate them with `wiki --update` instead.",
    "",
    "```yaml",
    `version: ${VERSION}`,
    `wiki-path: .wiki/`,
    `initialized: ${timestamp}`,
    "```",
    "",
  ].join("\n");
}

/**
 * On `--init`, appends a wiki-agent section to AGENTS.md (or CLAUDE.md if
 * only that exists) declaring the project uses wiki-agent. If neither file
 * exists, creates AGENTS.md with the section. Idempotent: if the marker is
 * already present, the version/timestamp block is refreshed. The section is
 * always appended (never prepended) so existing frontmatter and content stay
 * intact. Exported for testing.
 */
export async function appendWikiAgentFrontmatter(
  projectRoot: string,
): Promise<{ file: string; action: "created" | "appended" | "refreshed" } | null> {
  const candidates = ["AGENTS.md", "CLAUDE.md"];
  let targetFile: string | null = null;
  let existing: string | null = null;

  for (const name of candidates) {
    try {
      const content = await readFile(path.join(projectRoot, name), "utf8");
      targetFile = name;
      existing = content;
      break;
    } catch {
      // file doesn't exist — try next
    }
  }

  const section = buildWikiAgentSection();

  if (existing === null || targetFile === null) {
    // Neither file exists — create AGENTS.md with the section.
    const filePath = path.join(projectRoot, "AGENTS.md");
    await writeFile(filePath, `# Repository Guidelines\n${section}`, "utf8");
    return { file: "AGENTS.md", action: "created" };
  }

  const filePath = path.join(projectRoot, targetFile);
  const markerIdx = existing.indexOf(WIKI_AGENT_MARKER);

  if (markerIdx === -1) {
    // Marker absent — append the section.
    const ensureNewline = existing.endsWith("\n") ? "" : "\n";
    await writeFile(filePath, existing + ensureNewline + section, "utf8");
    return { file: targetFile, action: "appended" };
  }

  // Marker present — refresh the section by replacing from the marker to the
  // end of the file (the section is always the last appended block).
  const before = existing.slice(0, markerIdx).replace(/\n+$/, "\n");
  await writeFile(filePath, before + section, "utf8");
  return { file: targetFile, action: "refreshed" };
}




export interface RunOptions {
  command: WikiCommand;
  projectRoot: string;
  model: string;
  gitSummary?: string;
  maxIterations?: number;
  stream?: boolean;
  wikiPublish?: boolean;
  onEvent?: (event: AgentEvent) => void;
}

function resolveMaxIterations(): number {
  const env = process.env.WIKI_RECURSION_LIMIT;

  if (!env) {
    return DEFAULT_MAX_ITERATIONS;
  }

  const parsed = Number.parseInt(env, 10);

  if (Number.isSafeInteger(parsed) && parsed > 0) {
    return parsed;
  }

  return DEFAULT_MAX_ITERATIONS;
}

/**
 * Normalizes tool call arguments to an object. The Ollama API returns
 * arguments as a JSON string or as a parsed object depending on the model —
 * handle both.
 */
export async function runAgent(
  client: LLMClient,
  options: RunOptions,
): Promise<void> {
  const {
    command,
    projectRoot,
    model,
    gitSummary,
    maxIterations,
    stream = false,
    wikiPublish = false,
    onEvent = () => {},
  } = options;

  const maxIter = maxIterations ?? resolveMaxIterations();
  const tools = createTools(projectRoot);
  const systemPrompt = await createSystemPrompt(projectRoot);
  const userMessage = createUserMessage(command, projectRoot, gitSummary);

  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];
  const changedFiles: { action: string; path: string; description: string }[] = [];

  const toolDefinitions = tools.map((t) => t.definition);

  for (let i = 0; i < maxIter; i++) {
    let assistantContent = "";
    let toolCalls: LLMToolCall[] = [];

    try {
      if (stream) {
        const streamResponse = await client.chat({
          model,
          messages,
          tools: toolDefinitions,
          stream: true as const,
        });

        for await (const chunk of streamResponse) {
          if (chunk.message?.content) {
            assistantContent += chunk.message.content;
            onEvent({ type: "assistant", content: chunk.message.content });
          }

          if (chunk.message?.tool_calls) {
            toolCalls.push(...chunk.message.tool_calls.flatMap((tc: LLMToolCall) => tc.function?.name ? [{
              id: tc.id,
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments,
              },
            }] : []));
          }
        }
      } else {
        const result = await client.chat({
          model,
          messages,
          tools: toolDefinitions,
          stream: false as const,
        });

        const msgContent = result.message?.content;
        assistantContent = typeof msgContent === "string" ? msgContent : "";
        onEvent({ type: "assistant", content: assistantContent });

        if (result.message?.tool_calls) {
          toolCalls.push(...result.message!.tool_calls!.flatMap((tc: LLMToolCall) => tc.function?.name ? [{
            id: tc.id,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          }] : []));
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (assistantContent) {
        onEvent({
          type: "done",
          summary: `Agent completed with API warning: ${message}`,
        });
        break;
      }

      onEvent({ type: "error", message });
      break;
    }

    const assistantMessage: LLMMessage = {
      role: "assistant",
      content: assistantContent,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    };
    messages.push(assistantMessage);

    if (toolCalls.length === 0) {
      break;
    }

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      const args = toolCall.function.arguments;

      onEvent({ type: "tool", name: toolName, result: "" });

      const result = await executeTool(toolName, args, projectRoot);

      if (toolName === "write_file" || toolName === "edit_file") {
        const filePath = typeof args.path === "string" ? args.path : "unknown";
        if (result.startsWith("Wrote ") || result.startsWith("Edited ")) {
          // Record the change using the tool's factual result as the
          // description. We deliberately do NOT capture the assistant's
          // preceding prose: it is internal planning narration emitted
          // before the action, not a description of the resulting diff,
          // and leaking it into the report/PR body pollutes the published
          // record with deliberation that belongs in agent logs only.
          const description = result;
          changedFiles.push({
            action: toolName === "write_file" ? "created" : "edited",
            path: filePath,
            description,
          });
        }
      }

      onEvent({ type: "tool", name: toolName, result });

      // Ollama uses tool_name to associate tool results, while OpenAI uses tool_call_id.
      messages.push({
        role: "tool",
        content: result,
        tool_name: toolName,
        tool_call_id: toolCall.id,
      });
    }
  }
  await createWorkflowFile(projectRoot, wikiPublish);
  onEvent({ type: "tool", name: "create_workflow", result: wikiPublish ? "Created .github/workflows/update-wiki.yml (with wiki publish)" : "Created .github/workflows/update-wiki.yml" });

  if (command === "init") {
    const result = await appendWikiAgentFrontmatter(projectRoot);
    if (result) {
      onEvent({
        type: "tool",
        name: "append_agents_frontmatter",
        result: `${result.action} wiki-agent section in ${result.file}`,
      });
    }
  }
  // Write .wiki/.gitignore on every run so the run-metadata files below
  // stay out of git history in every target repo without manual setup.
  // Written before the no-op early return so it exists even on runs that
  // change nothing.
  await writeFile(
    path.join(projectRoot, ".wiki", ".gitignore"),
    WIKI_GITIGNORE,
    "utf8",
  );
  await untrackRunMetadataFiles(projectRoot);

  if (changedFiles.length === 0) {
    onEvent({ type: "done", summary: "Wiki is already current. No files changed." });
    return;
  }

  await synchronizeWikiIndexes(path.join(projectRoot, ".wiki"));

  await writeFile(
    path.join(projectRoot, ".wiki", ".last-updated.json"),
    JSON.stringify({ lastUpdated: new Date().toISOString() }, null, 2) + "\n",
    "utf8",
  );

  const reportFiles = filterReportFiles(changedFiles);

  const report = stripThinkingTags(generateUpdateReport(command, reportFiles));
  const title = generateUpdateTitle(command, reportFiles);
  await writeFile(
    path.join(projectRoot, ".wiki", ".last-update-report.md"),
    report,
    "utf8",
  );
  await writeFile(
    path.join(projectRoot, ".wiki", ".last-update-title.txt"),
    title + "\n",
    "utf8",
  );

  onEvent({ type: "done", summary: "Agent run complete" });
}


/**
 * Generates a markdown report of what changed during this run.
 * Written to .wiki/.last-update-report.md and used as the PR body.
 */
export function generateUpdateReport(
  command: WikiCommand,
  changedFiles: { action: string; path: string; description?: string }[],
): string {
  const timestamp = new Date().toISOString();
  const actionLabel = command === "init" ? "Initialized" : "Updated";

  if (changedFiles.length === 0) {
    return [
      `# Wiki ${actionLabel}`,
      "",
      "No files were changed. The wiki is already current.",
    ].join("\n") + "\n";
  }

  const created = changedFiles.filter((f) => f.action === "created");
  const edited = changedFiles.filter((f) => f.action === "edited");

  const lines = [
    `# Wiki ${actionLabel}`,
    "",
    `Run completed at ${timestamp}.`,
    "",
  ];

  if (created.length > 0) {
    lines.push("## New pages", "");
    for (const f of created) {
      lines.push(`- \`${f.path}\``);
      if (f.description && f.description.trim()) {
        lines.push(...formatDescription(f.description));
      }
    }
    lines.push("");
  }

  if (edited.length > 0) {
    lines.push("## Updated pages", "");
    for (const f of edited) {
      lines.push(`- \`${f.path}\``);
      if (f.description && f.description.trim()) {
        lines.push(...formatDescription(f.description));
      }
    }
    lines.push("");
  }

  lines.push(
    "## Summary",
    "",
    `This ${command === "init" ? "initialization" : "update"} run ${created.length > 0 ? `created ${created.length} page${created.length > 1 ? "s" : ""}` : ""}${created.length > 0 && edited.length > 0 ? " and " : ""}${edited.length > 0 ? `edited ${edited.length} page${edited.length > 1 ? "s" : ""}` : ""}.`,
  );

  return lines.join("\n") + "\n";
}

/**
 * Generates a concise pull-request title summarizing what this run changed.
 * Written to .wiki/.last-update-title.txt and used as the PR title by the
 * update-wiki workflow so the staging snapshot PR reflects its actual content
 * instead of a generic "wiki staging snapshot" label.
 */
export function generateUpdateTitle(
  command: WikiCommand,
  changedFiles: { action: string; path: string; description?: string }[],
): string {
  const created = changedFiles.filter((f) => f.action === "created").length;
  const edited = changedFiles.filter((f) => f.action === "edited").length;
  const action = command === "init" ? "initialize wiki" : "update wiki";

  if (created === 0 && edited === 0) {
    return `docs: ${action}`;
  }

  const parts: string[] = [];
  if (created > 0) {
    parts.push(`${created} new page${created > 1 ? "s" : ""}`);
  }
  if (edited > 0) {
    parts.push(`${edited} updated page${edited > 1 ? "s" : ""}`);
  }
  return `docs: ${action} (${parts.join(", ")})`;
}

/**
 * Formats a change description as indented markdown under a file listing.
 * Collapses whitespace, truncates overly long prose, and wraps it as a
 * blockquote so it renders cleanly under the `- \`path\`` bullet.
 */
function formatDescription(description: string): string[] {
  const trimmed = description.trim().replace(/\s+/g, " ");
  const maxLen = 500;
  const text = trimmed.length > maxLen ? trimmed.slice(0, maxLen) + "…" : trimmed;
  // Indent under the bullet as a nested blockquote
  return ["", `  > ${text}`, ""];
}