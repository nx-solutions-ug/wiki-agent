
function parseArgs(args: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  if (typeof args === "object" && args !== null && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return {};
}

import OpenAI from "openai";
import { type ChatCompletionMessageToolCall, type ChatCompletionChunk } from "openai/resources/index.js";

export interface LLMMessage {
  role: string;
  content: string;
  tool_calls?: LLMToolCall[];
  tool_name?: string;
  tool_call_id?: string;
}

export interface LLMToolCall {
  id?: string;
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

export interface LLMClient {
  chat(options: {
    model: string;
    messages: LLMMessage[];
    tools?: any[];
    stream?: boolean;
  }): any; // Promise<any> | AsyncGenerator<any>
}

export class OpenAIAdapter implements LLMClient {
  constructor(private openai: OpenAI) {}

  async chat(options: {
    model: string;
    messages: LLMMessage[];
    tools?: any[];
    stream?: boolean;
  }): Promise<any> {
    const messages = options.messages.map((m) => {
      const mapped: any = { role: m.role, content: m.content || "" };
      if (m.role === "tool") {
        mapped.tool_call_id = m.tool_call_id;
      }
      if (m.role === "assistant" && m.tool_calls) {
        mapped.tool_calls = m.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.function.name,
            arguments: JSON.stringify(tc.function.arguments),
          },
        }));
      }
      return mapped;
    });

    const tools = options.tools?.map((t: any) => ({
      type: "function" as const,
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      },
    }));

    if (options.stream) {
      const stream = await this.openai.chat.completions.create({
        model: options.model,
        messages,
        ...(tools && tools.length > 0 ? { tools } : {}),
        stream: true,
      });

      return (async function* () {
        const activeToolCalls = new Map<number, any>();

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            yield { message: { content: delta.content } };
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              let active = activeToolCalls.get(tc.index);
              if (!active) {
                active = {
                  id: tc.id || "",
                  function: { name: "", arguments: "" }
                };
                activeToolCalls.set(tc.index, active);
              }
              if (tc.id) {
                active.id = tc.id;
              }
              if (tc.function?.name) {
                active.function.name += tc.function.name;
              }
              if (tc.function?.arguments) {
                active.function.arguments += tc.function.arguments;
                if (active.function.arguments.length > 100_000) {
                  active.function.arguments = active.function.arguments.slice(0, 100_000);
                }
              }
            }
          }
        }

        if (activeToolCalls.size > 0) {
          const tool_calls = Array.from(activeToolCalls.values()).map((tc) => ({
            id: tc.id,
            function: {
              name: tc.function.name,
              arguments: parseArgs(tc.function.arguments),
            },
          }));
          yield { message: { tool_calls } };
        }
      })();
    } else {
      const res = await this.openai.chat.completions.create({
        model: options.model,
        messages,
        ...(tools && tools.length > 0 ? { tools } : {}),
        stream: false,
      });
      const msg = res.choices[0].message;
      return {
        message: {
          content: msg.content || "",
          tool_calls: msg.tool_calls?.map((tc: any) => ({
            id: tc.id,
            function: {
              name: tc.function.name,
              arguments: parseArgs(tc.function.arguments),
            },
          })),
        },
      };
    }
  }
}
