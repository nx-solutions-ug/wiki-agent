import { mkdir, writeFile, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { createSystemPrompt, createUserMessage, type WikiCommand } from "./prompt.js";
import { createTools, executeTool, stripThinkingTags } from "./tools.js";
import { synchronizeWikiIndexes } from "./index-middleware.js";
import { VERSION } from "./version.js";
import { Ollama } from "ollama";

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

export const WIKI_GITIGNORE =
  RUN_METADATA_FILES.map((f) => `/${f}`).join("\n") + "\n";

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
  const metadataPaths = RUN_METADATA_FILES.map((f) => path.join(".wiki", f));
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


/**
 * Ollama SDK message format. Tool call arguments are objects (not strings),
 * and tool response messages use `tool_name` (not `tool_call_id`).
 */
interface OllamaMessage {
  role: string;
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}

interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
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
function normalizeToolCallArgs(
  args: unknown,
): Record<string, unknown> {
  if (args === null || args === undefined) {
    return {};
  }

  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Malformed JSON — return empty so the tool gets called with no args
      return {};
    }
    return {};
  }

  if (typeof args === "object" && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }

  return {};
}

export async function runAgent(
  client: Ollama,
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

  const messages: OllamaMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];
  const changedFiles: { action: string; path: string; description: string }[] = [];

  for (let i = 0; i < maxIter; i++) {
    let assistantContent = "";
    let toolCalls: OllamaToolCall[] = [];

    try {
      if (stream) {
        const streamResponse = await client.chat({
          model,
          messages: messages as never,
          tools: tools.map((t) => t.definition) as never,
          stream: true,
        });

        for await (const chunk of streamResponse) {
          if (chunk.message?.content) {
            assistantContent += chunk.message.content;
            onEvent({ type: "assistant", content: chunk.message.content });
          }

          if (chunk.message?.tool_calls) {
            toolCalls.push(...chunk.message.tool_calls.flatMap(tc => tc.function?.name ? [{
              function: {
                name: tc.function.name,
                arguments: normalizeToolCallArgs(tc.function.arguments),
              },
            }] : []));
          }
        }
      } else {
        const result = await client.chat({
          model,
          messages: messages as never,
          tools: tools.map((t) => t.definition) as never,
          stream: false,
        });

        const msgContent = result.message?.content;
        assistantContent = typeof msgContent === "string" ? msgContent : "";
        onEvent({ type: "assistant", content: assistantContent });

        if (result.message?.tool_calls) {
          toolCalls.push(...result.message.tool_calls.flatMap(tc => tc.function?.name ? [{
            function: {
              name: tc.function.name,
              arguments: normalizeToolCallArgs(tc.function.arguments),
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

    const assistantMessage: OllamaMessage = {
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

      // Ollama uses tool_name (not tool_call_id) to associate tool results
      messages.push({
        role: "tool",
        content: result,
        tool_name: toolName,
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
 * Creates a GitHub Actions workflow file in the target repo that checks out
 * the wiki-agent source, builds it, and runs --update --print on a schedule.
 */
async function createWorkflowFile(projectRoot: string, wikiPublish: boolean): Promise<void> {
  const workflowsDir = path.join(projectRoot, ".github", "workflows");
  const workflowPath = path.join(workflowsDir, "update-wiki.yml");

  await mkdir(workflowsDir, { recursive: true });

  const runFlags = wikiPublish ? "--update --print --verbose --wiki" : "--update --print --verbose";

  const workflow: string[] = [
    "name: Wiki Update",
    "",
    "on:",
    "  workflow_dispatch:",
    "  push:",
    "    branches:",
    "      - main",
    "  schedule:",
    '    - cron: "0 8 * * *"',
    "",
    "permissions:",
    "  contents: write",
    "  pull-requests: write",
    "",
    "concurrency:",
    "  group: wiki-update-${{ github.ref }}",
    "  cancel-in-progress: true",
    "",
    "jobs:",
    "  update:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: Generate token",
    "        id: token",
    "        uses: actions/create-github-app-token@v3",
    "        with:",
    "          client-id: ${{ secrets.APP_CLIENT_ID }}",
    "          private-key: ${{ secrets.APP_PRIVATE_KEY }}",
    "        continue-on-error: true",
    "",
    "      - name: Check out repository",
    "        uses: actions/checkout@v7",
    "        with:",
    "          token: ${{ steps.token.outputs.token || secrets.GITHUB_TOKEN }}",
    "",
    "      - name: Set up Bun",
    "        uses: oven-sh/setup-bun@v2",
    "",
    "      - name: Set up Node.js",
    "        uses: actions/setup-node@v7",
    "        with:",
    '          node-version: "25"',
    "",
    "      - name: Install Wiki Agent",
    "        run: bun add -g @chronova/wiki-agent",
    "",
    "      - name: Run Wiki Agent",
    `        run: wiki ${runFlags}`,
    "        env:",
    "          WIKI_OLLAMA_MODE: cloud",
    '          WIKI_OLLAMA_API_KEY: ${{ secrets.WIKI_OLLAMA_API_KEY }}',
    "          WIKI_MODEL: ${{ vars.WIKI_MODEL || 'kimi-k2.7-code' }}",
    "          GH_TOKEN: ${{ steps.token.outputs.token || secrets.GITHUB_TOKEN }}",
    "",
    "      - name: Generate timestamp",
    "        id: timestamp",
    "        run: echo \"timestamp=$(date +%s)\" >> $GITHUB_OUTPUT",
    "",
    "      - name: Check for changes",
    "        id: report",
    "        run: |",
    "          # Collect changes under .wiki (tracked + untracked), excluding",
    "          # the run metadata files. Only content changes open a PR.",
    "          changes=$(git status --porcelain .wiki | sed 's/^...//' | grep -vE '^\\.wiki/\\.(last-update-report\\.md|last-update-title\\.txt|last-updated\\.json)$' | sed '/^[[:space:]]*$/d')",
    "          if [ -n \"$changes\" ]; then",
    "            echo \"has_changes=true\" >> $GITHUB_OUTPUT",
    "            echo \"body<<EOF\" >> $GITHUB_OUTPUT",
    "            cat .wiki/.last-update-report.md >> $GITHUB_OUTPUT",
    "            echo \"\" >> $GITHUB_OUTPUT",
    "            echo \"EOF\" >> $GITHUB_OUTPUT",
    "            # PR title + commit message reflecting the actual run. Falls back",
    "            # to a generic label if the agent did not write the title file.",
    "            echo \"title<<EOF\" >> $GITHUB_OUTPUT",
    "            {",
    "              if [ -f .wiki/.last-update-title.txt ]; then cat .wiki/.last-update-title.txt; else echo \"docs: wiki staging snapshot\"; fi",
    "            } >> $GITHUB_OUTPUT",
    "            echo \"EOF\" >> $GITHUB_OUTPUT",
    "          else",
    "            echo \"has_changes=false\" >> $GITHUB_OUTPUT",
    "          fi",
    "",
  ];

  if (wikiPublish) {
    workflow.push(
      "      - name: Repository coordinates",
      "        id: coords",
      "        run: echo \"owner_repo=${GITHUB_REPOSITORY}\" >> $GITHUB_OUTPUT",
      "",
      "      - name: Detect wiki initialization",
      "        id: wiki-init",
      "        env:",
      "          TOKEN: ${{ secrets.WIKI_PUSH_TOKEN || steps.token.outputs.token || secrets.GITHUB_TOKEN }}",
      "        run: |",
      "          REMOTE=\"https://x-access-token:${TOKEN}@github.com/${{ steps.coords.outputs.owner_repo }}.wiki.git\"",
      "          if git ls-remote --exit-code \"$REMOTE\" HEAD >/dev/null 2>&1; then",
      "            echo \"initialized=true\" >> $GITHUB_OUTPUT",
      "          else",
      "            echo \"initialized=false\" >> $GITHUB_OUTPUT",
      "            echo \"::warning::Wiki is not initialized. Create the first page in the GitHub UI (Wiki tab -> New Page), then rerun. Staging PR will still be opened.\" >> $GITHUB_OUTPUT",
      "          fi",
      "",
      "      - name: Publish to wiki repo",
      "        id: publish",
      "        if: steps.report.outputs.has_changes == 'true' && steps.wiki-init.outputs.initialized == 'true'",
      "        env:",
      "          TOKEN: ${{ secrets.WIKI_PUSH_TOKEN || steps.token.outputs.token || secrets.GITHUB_TOKEN }}",
      "        run: |",
      "          WIKI_URL=\"https://x-access-token:${TOKEN}@github.com/${{ steps.coords.outputs.owner_repo }}.wiki.git\"",
      "          rm -rf /tmp/wiki /tmp/wiki-flat",
      "          wiki-flatten \"$GITHUB_WORKSPACE/.wiki\" /tmp/wiki-flat",
      "          git clone \"$WIKI_URL\" /tmp/wiki",
      "          cd /tmp/wiki",
      "          # rsync the flattened wiki output (flat names, Home.md, _Sidebar.md).",
      "          # --exclude='.git' protects the wiki clone's .git directory from --delete.",
      "          rsync -a --delete \\",
      "            --exclude='.git' \\",
      "            /tmp/wiki-flat/ ./",
      "          git add -A",
      "          if ! git diff --cached --quiet; then",
      "            git -c user.name='wiki-agent[bot]' -c user.email='bot@wiki-agent' \\",
      "              commit -m \"docs: update wiki\"",
      "            if ! git push origin master 2>&1 | tee /tmp/wiki-push.log; then",
      "              echo \"::error::Failed to push to the wiki repo. Ensure the GitHub App has contents:write on the repository (which covers the wiki), or set a WIKI_PUSH_TOKEN secret with repo scope.\"",
      "              exit 1",
      "            fi",
      "            echo \"published=true\" >> $GITHUB_OUTPUT",
      "          else",
      "            echo \"::warning::No net wiki content changes after sync; skipping wiki push.\"",
      "            echo \"published=false\" >> $GITHUB_OUTPUT",
      "          fi",
    );
  }

  workflow.push(
    "      - name: Create wiki staging snapshot pull request",
    "        uses: peter-evans/create-pull-request@v8",
    "        if: steps.report.outputs.has_changes == 'true'",
    "        with:",
    "          token: ${{ secrets.WIKI_PUSH_TOKEN || steps.token.outputs.token || secrets.GITHUB_TOKEN }}",
    "          branch: wiki/staging-${{ steps.timestamp.outputs.timestamp }}",
    "          add-paths: .wiki",
    "          title: ${{ steps.report.outputs.title }}",
    "          commit-message: ${{ steps.report.outputs.title }}",
    '          body: ${{ steps.report.outputs.body }}',
  );

  await writeFile(workflowPath, workflow.join("\n") + "\n", "utf8");
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