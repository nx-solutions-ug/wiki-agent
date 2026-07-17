import path from "node:path";
import { Ollama } from "ollama";
import { createSystemPrompt, createUserMessage, type WikiCommand } from "./prompt.js";
import { createTools, executeTool } from "./tools.js";
import { synchronizeWikiIndexes } from "./index-middleware.js";

export type AgentEvent =
  | { type: "assistant"; content: string }
  | { type: "tool"; name: string; result: string }
  | { type: "error"; message: string }
  | { type: "done"; summary: string };

const DEFAULT_MAX_ITERATIONS = 200;

interface ToolCall {
  function: { name: string; arguments: string };
  id?: string;
}

interface ChatMessage {
  role: string;
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
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
  const systemPrompt = createSystemPrompt(projectRoot);
  const userMessage = createUserMessage(command, projectRoot, gitSummary);

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  for (let i = 0; i < maxIter; i++) {
    let assistantContent = "";
    let toolCalls: ToolCall[] = [];

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
                  arguments: typeof tc.function.arguments === "string"
                    ? tc.function.arguments
                    : JSON.stringify(tc.function.arguments ?? {}),
                },
                id: ("id" in tc && typeof tc.id === "string" ? tc.id : tc.function.name),
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
                arguments: typeof tc.function.arguments === "string"
                  ? tc.function.arguments
                  : JSON.stringify(tc.function.arguments ?? {}),
              },
              id: ("id" in tc && typeof tc.id === "string" ? tc.id : tc.function.name),
            });
          }
        }
      }
    }

    const assistantMessage: ChatMessage = {
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
      let parsedArgs: Record<string, unknown>;

      try {
        parsedArgs = JSON.parse(toolCall.function.arguments || "{}");
      } catch {
        parsedArgs = {};
      }

      onEvent({ type: "tool", name: toolName, result: "" });

      const result = await executeTool(toolName, parsedArgs, projectRoot);

      onEvent({ type: "tool", name: toolName, result });

      messages.push({
        role: "tool",
        content: result,
        tool_call_id: toolCall.id ?? toolName,
      });
    }
  }

  await synchronizeWikiIndexes(path.join(projectRoot, ".wiki"));

  onEvent({ type: "done", summary: "Agent run complete" });
}