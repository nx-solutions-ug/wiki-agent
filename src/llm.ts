import OpenAI from "openai";
import { Ollama, type Message as OllamaSDKMessage } from "ollama";


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



export interface LLMResponse {
  message: {
    content: string;
    tool_calls?: LLMToolCall[];
  };
}
export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";

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


export interface LLMTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}
export interface LLMClient {
  chat(options: {
    model: string;
    messages: LLMMessage[];
    tools?: LLMTool[];
    stream?: false;
  }): Promise<LLMResponse>;
  chat(options: {
    model: string;
    messages: LLMMessage[];
    tools?: LLMTool[];
    stream: true;
  }): Promise<AsyncGenerator<LLMResponse>>;
}

export class OpenAIAdapter implements LLMClient {
  constructor(private openai: OpenAI) {}

  chat(options: { model: string; messages: LLMMessage[]; tools?: LLMTool[]; stream?: false }): Promise<LLMResponse>;
  chat(options: { model: string; messages: LLMMessage[]; tools?: LLMTool[]; stream: true }): Promise<AsyncGenerator<LLMResponse>>;
  async chat(options: { model: string; messages: LLMMessage[]; tools?: LLMTool[]; stream?: boolean }): Promise<LLMResponse | AsyncGenerator<LLMResponse>> {
    const messages = options.messages.map((m): OpenAI.Chat.ChatCompletionMessageParam => {
      if (m.role === "tool") {
        return { role: "tool", content: m.content || "", tool_call_id: m.tool_call_id || "" };
      }
      if (m.role === "assistant" && m.tool_calls) {
        return {
          role: "assistant",
          content: m.content || "",
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id || "",
            type: "function" as const,
            function: {
              name: tc.function.name,
              arguments: typeof tc.function.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function.arguments),
            },
          })),
        };
      }
      if (m.role === "system") {
        return { role: "system", content: m.content || "" };
      }
      return { role: "user", content: m.content || "" };
    });

    const tools = options.tools?.map((t): OpenAI.Chat.ChatCompletionTool => ({
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
        const activeToolCalls = new Map<number, { id: string, function: { name: string, arguments: string } }>();

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
                  throw new Error("Tool call arguments exceed maximum length of 100,000 characters");
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
          yield { message: { content: "", tool_calls } };
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
          tool_calls: msg.tool_calls?.map((tcObj) => {
            const tc = tcObj as import("openai/resources/index.js").ChatCompletionMessageFunctionToolCall;
            const func = tc.function;
            return {
              id: tc.id,
              function: {
                name: func.name,
                arguments: parseArgs(func.arguments),
              },
            };
          }),
        },
      };
    }
  }
}



export class OllamaAdapter implements LLMClient {
  constructor(private ollama: Ollama) {}

  chat(options: { model: string; messages: LLMMessage[]; tools?: LLMTool[]; stream?: false }): Promise<LLMResponse>;
  chat(options: { model: string; messages: LLMMessage[]; tools?: LLMTool[]; stream: true }): Promise<AsyncGenerator<LLMResponse>>;
  async chat(options: { model: string; messages: LLMMessage[]; tools?: LLMTool[]; stream?: boolean }): Promise<LLMResponse | AsyncGenerator<LLMResponse>> {
    const messages = options.messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.tool_calls && m.tool_calls.length > 0 ? {
        tool_calls: m.tool_calls.map((tc) => ({
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        })),
      } : {}),
      ...(m.tool_name ? { tool_name: m.tool_name } : {}),
    }));

    if (options.stream) {
      const stream = await this.ollama.chat({
        model: options.model,
        messages: messages as OllamaSDKMessage[],
        ...(options.tools && options.tools.length > 0 ? { tools: options.tools as any } : {}),
        stream: true,
      });
      return (async function* () {
        let streamToolCallIds: string[] | null = null;
        for await (const chunk of stream) {
          if (chunk.message.tool_calls && chunk.message.tool_calls.length > 0 && !streamToolCallIds) {
             streamToolCallIds = chunk.message.tool_calls.map(() => "call_" + Math.random().toString(36).slice(2));
          }
          yield {
            message: {
              content: chunk.message.content || "",
              ...(chunk.message.tool_calls && chunk.message.tool_calls.length > 0 ? {
                tool_calls: chunk.message.tool_calls.map((tc, idx) => ({
                  id: streamToolCallIds ? streamToolCallIds[idx] : "call_" + Math.random().toString(36).slice(2),
                  function: {
                    name: tc.function.name,
                    arguments: tc.function.arguments as Record<string, unknown>,
                  },
                })),
              } : {}),
            }
          };
        }
      })();
    } else {
      const res = await this.ollama.chat({
        model: options.model,
        messages: messages as OllamaSDKMessage[],
        ...(options.tools && options.tools.length > 0 ? { tools: options.tools as any } : {}),
        stream: false,
      });
      return {
        message: {
          content: res.message.content || "",
          ...(res.message.tool_calls && res.message.tool_calls.length > 0 ? {
            tool_calls: res.message.tool_calls.map((tc) => ({
              id: "call_" + Math.random().toString(36).slice(2),
              function: {
                name: tc.function.name,
                arguments: tc.function.arguments as Record<string, unknown>,
              },
            })),
          } : {}),
        }
      };
    }
  }
}
