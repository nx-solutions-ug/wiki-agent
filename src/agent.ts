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

      onEvent({ type: "tool", name: toolName, result });

      // Ollama uses tool_name (not tool_call_id) to associate tool results
      messages.push({
        role: "tool",
        content: result,
        tool_name: toolName,
      });
    }
  }

  await synchronizeWikiIndexes(path.join(projectRoot, ".wiki"));

  if (command === "init") {
    await createWorkflowFile(projectRoot);
    onEvent({ type: "tool", name: "create_workflow", result: "Created .github/workflows/update-wiki.yml" });
  }

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
    "      - name: Check out repository",
    "        uses: actions/checkout@v7",
    "",
    "      - name: Set up Node.js",
    "        uses: actions/setup-node@v7",
    "        with:",
    '          node-version: "22"',
    "",
    "      - name: Build Wiki Agent",
    "        run: |",
    "          git clone --branch main --depth 1 https://github.com/nx-solutions-ug/wiki-agent.git /tmp/wiki-agent",
    "          cd /tmp/wiki-agent",
    "          npm install",
    "          npx tsc -p tsconfig.json",
    "",
    "      - name: Run Wiki Agent",
    "        run: node /tmp/wiki-agent/dist/cli.js --update --print",
    "        env:",
    "          WIKI_OLLAMA_MODE: cloud",
    '          WIKI_OLLAMA_API_KEY: ${{ secrets.WIKI_OLLAMA_API_KEY }}',
    "          WIKI_MODEL: ${{ vars.WIKI_MODEL || 'kimi-k2.7-code' }}",
    "",
    "      - name: Create Wiki update pull request",
    "        uses: peter-evans/create-pull-request@v8",
    "        with:",
    "          add-paths: .wiki",
    "          branch: wiki/update",
    '          commit-message: "docs: update wiki"',
    '          title: "docs: update wiki"',
    "          body: |",
    "            Automated wiki documentation update.",
    "",
    "            This PR was generated by the scheduled Wiki Update workflow.",
    "",
  ].join("\n");

  await writeFile(workflowPath, workflow, "utf8");
}