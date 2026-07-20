import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSystemPrompt, createUserMessage, type WikiCommand } from "./prompt.js";
import { createTools, executeTool } from "./tools.js";
import { synchronizeWikiIndexes } from "./index-middleware.js";
import { Ollama } from "ollama";

export type AgentEvent =
  | { type: "assistant"; content: string }
  | { type: "tool"; name: string; result: string }
  | { type: "error"; message: string }
  | { type: "done"; summary: string };

const DEFAULT_MAX_ITERATIONS = 200;

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
            for (const tc of chunk.message.tool_calls) {
              if (tc.function?.name) {
                toolCalls.push({
                  function: {
                    name: tc.function.name,
                    arguments: normalizeToolCallArgs(tc.function.arguments),
                  },
                });
              }
            }
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
          for (const tc of result.message.tool_calls) {
            if (tc.function?.name) {
              toolCalls.push({
                function: {
                  name: tc.function.name,
                  arguments: normalizeToolCallArgs(tc.function.arguments),
                },
              });
            }
          }
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
          // Use the assistant's prose preceding this tool call as the
          // human-readable description of what changed. Falls back to the
          // tool result if the model didn't narrate the change.
          const description = assistantContent.trim() || result;
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

  await createWorkflowFile(projectRoot);
  onEvent({ type: "tool", name: "create_workflow", result: "Created .github/workflows/update-wiki.yml" });

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

  const report = generateUpdateReport(command, changedFiles);
  await writeFile(
    path.join(projectRoot, ".wiki", ".last-update-report.md"),
    report,
    "utf8",
  );

  onEvent({ type: "done", summary: "Agent run complete" });
}

/**
 * Creates a GitHub Actions workflow file in the target repo that checks out
 * the wiki-agent source, builds it, and runs --update --print on a schedule.
 */
async function createWorkflowFile(projectRoot: string): Promise<void> {
  const workflowsDir = path.join(projectRoot, ".github", "workflows");
  const workflowPath = path.join(workflowsDir, "update-wiki.yml");

  await mkdir(workflowsDir, { recursive: true });

  const workflow = [
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
    "      - name: Set up Node.js",
    "        uses: actions/setup-node@v7",
    "        with:",
    '          node-version: "25"',
    "",
    "      - name: Build Wiki Agent",
    "        run: |",
    "          git clone --branch main --depth 1 https://github.com/nx-solutions-ug/wiki-agent.git /tmp/wiki-agent",
    "          cd /tmp/wiki-agent",
    "          npm install",
    "          npx tsc -p tsconfig.json",
    "",
    "      - name: Run Wiki Agent",
    "        run: node /tmp/wiki-agent/dist/cli.js --update --print --verbose",
    "        env:",
    "          WIKI_OLLAMA_MODE: cloud",
    '          WIKI_OLLAMA_API_KEY: ${{ secrets.WIKI_OLLAMA_API_KEY }}',
    "          WIKI_MODEL: ${{ vars.WIKI_MODEL || 'kimi-k2.7-code' }}",
    "",
    "      - name: Generate timestamp",
    "        id: timestamp",
    "        run: echo \"timestamp=$(date +%s)\" >> $GITHUB_OUTPUT",
    "",
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
    "      - name: Check for changes",
    "        id: report",
    "        run: |",
    "          # Collect changes under .wiki (tracked + untracked), excluding",
    "          # the run metadata files. Only content changes open a PR.",
    "          changes=$(git status --porcelain .wiki | sed 's/^...//' | grep -vE '^\\.wiki/\\.(last-update-report\\.md|last-updated\\.json)$' | sed '/^[[:space:]]*$/d')",
    "          if [ -n \"$changes\" ]; then",
    "            echo \"has_changes=true\" >> $GITHUB_OUTPUT",
    "            echo \"body<<EOF\" >> $GITHUB_OUTPUT",
    "            cat .wiki/.last-update-report.md >> $GITHUB_OUTPUT",
    "            echo \"\" >> $GITHUB_OUTPUT",
    "            echo \"EOF\" >> $GITHUB_OUTPUT",
    "          else",
    "            echo \"has_changes=false\" >> $GITHUB_OUTPUT",
    "          fi",
    "",
    "      - name: Publish to wiki repo",
    "        id: publish",
    "        if: steps.report.outputs.has_changes == 'true' && steps.wiki-init.outputs.initialized == 'true'",
    "        env:",
    "          TOKEN: ${{ secrets.WIKI_PUSH_TOKEN || steps.token.outputs.token || secrets.GITHUB_TOKEN }}",
    "        run: |",
    "          BRANCH=\"wiki/update-${{ steps.timestamp.outputs.timestamp }}\"",
    "          WIKI_URL=\"https://x-access-token:${TOKEN}@github.com/${{ steps.coords.outputs.owner_repo }}.wiki.git\"",
    "          rm -rf /tmp/wiki",
    "          git clone \"$WIKI_URL\" /tmp/wiki",
    "          cd /tmp/wiki",
    "          git checkout -b \"$BRANCH\"",
    "          # --exclude='.git' protects the wiki clone's .git directory from --delete.",
    "          rsync -a --delete \\",
    "            --exclude='.git' \\",
    "            --exclude='.last-update-report.md' \\",
    "            --exclude='.last-updated.json' \\",
    "            --exclude='config.json' \\",
    "            \"$GITHUB_WORKSPACE/.wiki/\" ./",
    "          git add -A",
    "          if ! git diff --cached --quiet; then",
    "            git -c user.name='wiki-agent[bot]' -c user.email='bot@wiki-agent' \\",
    "              commit -m \"docs: update wiki\"",
    "            if ! git push origin \"$BRANCH\" 2>&1 | tee /tmp/wiki-push.log; then",
    "              echo \"::error::Failed to push to the wiki repo. Ensure the GitHub App has contents:write on the repository (which covers the wiki), or set a WIKI_PUSH_TOKEN secret with repo scope.\"",
    "              exit 1",
    "            fi",
    "            echo \"branch=$BRANCH\" >> $GITHUB_OUTPUT",
    "          else",
    "            echo \"::warning::No net wiki content changes after sync; skipping wiki push.\"",
    "            echo \"branch=\" >> $GITHUB_OUTPUT",
    "          fi",
    "",
    "      - name: Open wiki update pull request",
    "        if: steps.report.outputs.has_changes == 'true' && steps.wiki-init.outputs.initialized == 'true' && steps.publish.outputs.branch != ''",
    "        env:",
    "          GH_TOKEN: ${{ secrets.WIKI_PUSH_TOKEN || steps.token.outputs.token || secrets.GITHUB_TOKEN }}",
    "        run: |",
    "          gh pr create --repo \"${{ steps.coords.outputs.owner_repo }}.wiki\" \\",
    "            --head \"wiki/update-${{ steps.timestamp.outputs.timestamp }}\" \\",
    "            --base master \\",
    "            --title \"docs: update wiki\" \\",
    "            --body-file .wiki/.last-update-report.md",
    "",
    "      - name: Create wiki staging snapshot pull request",
    "        uses: peter-evans/create-pull-request@v8",
    "        if: steps.report.outputs.has_changes == 'true'",
    "        with:",
    "          token: ${{ secrets.WIKI_PUSH_TOKEN || steps.token.outputs.token || secrets.GITHUB_TOKEN }}",
    "          branch: wiki/staging-${{ steps.timestamp.outputs.timestamp }}",
    "          add-paths: .wiki",
    '          title: "docs: wiki staging snapshot"',
    '          body: ${{ steps.report.outputs.body }}',
  ].join("\n");
  await writeFile(workflowPath, workflow, "utf8");
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